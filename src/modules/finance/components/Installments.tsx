import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CastleBarChart } from '../../../shared/components/charts';
import type { BarDatum } from '../../../shared/components/charts';
import RpgNumberInput from '../../../shared/components/RpgNumberInput';
import { useToast } from '../../../shared/components/useToast';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import { MonthNavigator } from './shared/MonthNavigator';
import InstallmentAddForm from './shared/InstallmentAddForm';
import { Section, Gauge, Rune, Cartouche } from '../../../shared/components/codex/CodexPrimitives';
import { Compass, CrossMark, ArrowRight, Checkmark, Pencil } from '../../../shared/components/icons';
import HelpBubble from '../../../shared/components/HelpBubble';
import { formatCurrency } from '../utils/format';
import { unwrap, failureMessage } from '../utils/api-ext';
import { emitMovementDeleted } from '../utils/rpg-events';

interface InstallmentRow {
  id: string;
  description: string;
  amount: number;
  currency: 'ARS' | 'USD';
  category: string;
  installments: number;
  installmentCount?: number;
  installmentNumber?: number;
  installmentGroupId: string;
  /** 0/1 flag straight out of SQLite — never a name. */
  forThirdParty?: number | string;
  /** Resolved from the loan that shares the instalment group. */
  thirdPartyName?: string | null;
  date: string;
}

interface ProjectionMonth {
  month: string;
  total: number;
}

function todayMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function parseInstallmentNumber(row: InstallmentRow): { current: number; total: number } {
  return { current: row.installmentNumber ?? 1, total: row.installmentCount ?? row.installments };
}

function cleanDescription(desc: string): string {
  return desc.replace(/\s*\(Cuota \d+\/\d+\)\s*$/, '');
}

interface InstallmentGroup {
  groupId: string;
  description: string;
  rows: InstallmentRow[];
}

export default function Installments() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const confirm = useConfirm();
  const currentMonth = todayMonth();
  const [month, setMonth] = useState(currentMonth);
  const [rows, setRows] = useState<InstallmentRow[]>([]);
  const [projection, setProjection] = useState<ProjectionMonth[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');

  const loadRows = useCallback(async (m: string) => {
    setLoading(true);
    setError(false);
    try {
      const data = await window.api.financeGetInstallmentsForMonth(m);
      setRows(data as InstallmentRow[]);
    } catch (err) {
      console.error('[Installments] financeGetInstallmentsForMonth failed:', err);
      setError(true);
      toast({ type: 'warning', message: t('coinify.loadError', 'Error al cargar datos') });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProjection = useCallback(async () => {
    try {
      const data = await window.api.financeGetInstallmentProjection(12);
      setProjection(data as ProjectionMonth[]);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => { loadRows(month); }, [month, loadRows]);
  useEffect(() => { loadProjection(); }, [loadProjection]);

  useEffect(() => {
    const handler = () => { loadRows(month); loadProjection(); };
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [month, loadRows, loadProjection]);

  const groups = useMemo<InstallmentGroup[]>(() => {
    const map = new Map<string, InstallmentRow[]>();
    for (const row of rows) {
      const gid = row.installmentGroupId;
      if (!map.has(gid)) map.set(gid, []);
      map.get(gid)!.push(row);
    }
    return Array.from(map.entries()).map(([groupId, groupRows]) => ({
      groupId,
      description: cleanDescription(groupRows[0].description),
      rows: groupRows,
    }));
  }, [rows]);

  const handleDeleteGroup = async (groupId: string) => {
    const ok = await confirm({ message: t('coinify.deleteInstallmentGroupConfirm', '¿Eliminar este grupo de cuotas? Se borrarán todas las transacciones asociadas.'), danger: true, confirmText: t('coinify.delete') });
    if (!ok) return;
    try {
      await window.api.financeDeleteInstallmentGroup(groupId);
      // A plan created from the ledger paid ONE EXPENSE_LOGGED with the group
      // id as its ref; deleting the plan hands that XP back. Plans created on
      // this screen never paid, so the engine finds nothing and refunds 0.
      await emitMovementDeleted(groupId, 'expense');
      loadRows(month);
      loadProjection();
      window.dispatchEvent(new Event('finance:dataChanged'));
      toast({ type: 'coin', message: t('coinify.installmentGroupDeleted', 'Grupo de cuotas eliminado') });
    } catch (err) {
      console.error('[Installments] financeDeleteInstallmentGroup failed:', err);
      toast({ type: 'warning', message: t('coinify.deleteError', 'Error al eliminar') });
    }
  };

  /**
   * ARS only — mixing currencies into one sum is exactly the bug the unified
   * `formatCurrency` signature is there to prevent.
   */
  const arsRows = rows.filter((r) => r.currency !== 'USD');
  const usdRows = rows.filter((r) => r.currency === 'USD');
  const totalOwn = arsRows.filter((r) => !r.forThirdParty).reduce((acc, r) => acc + r.amount, 0);
  const totalThirdParty = arsRows.filter((r) => !!r.forThirdParty).reduce((acc, r) => acc + r.amount, 0);
  /** What the card bills you this month. NOT a net — third-party rows get reimbursed. */
  const totalBilled = totalOwn + totalThirdParty;
  const totalUsd = usdRows.reduce((acc, r) => acc + r.amount, 0);

  const saveInstallmentAmount = async (rowId: string, raw: string) => {
    const val = parseFloat(raw);
    if (!Number.isFinite(val) || val <= 0) {
      toast({ type: 'warning', message: t('coinify.validationAmount', 'Ingresá un monto válido') });
      return;
    }
    const result = await unwrap(window.api.financeUpdateInstallmentAmount(rowId, val));
    if (!result.ok) {
      toast({ type: 'warning', message: failureMessage(result.reason, t) });
      return;
    }
    setEditingId(null);
    loadRows(month);
    loadProjection();
    window.dispatchEvent(new Event('finance:dataChanged'));
  };

  const projectionLabel = (m: string) => {
    const [y, mo] = m.split('-').map(Number);
    const locale = i18n.language === 'en' ? 'en-US' : 'es-AR';
    return new Date(y, mo - 1).toLocaleDateString(locale, { month: 'short', year: '2-digit' });
  };

  const barData = useMemo<BarDatum[]>(
    () =>
      projection.map((p) => ({
        label: projectionLabel(p.month),
        value: p.total,
        status: p.month === currentMonth ? ('ok' as const) : ('under' as const),
      })),
    [projection, currentMonth]
  );

  return (
    /* La pantalla nació pensada para una tarjeta angosta: a 1600 px el nombre
       del plan quedaba contra el borde izquierdo y el importe contra el
       derecho. Un ancho máximo centrado deja al ojo asociar nombre ↔ monto. */
    <div className="coin-installments">
      <div style={{ marginBottom: 16 }}>
        <MonthNavigator month={month} onChange={setMonth} />
      </div>

      <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        <button className="rpg-button" onClick={() => setShowForm(!showForm)}>
          {showForm ? t('common.cancel') : t('coinify.addInstallment', 'Nueva cuota')}
        </button>
      </div>

      {showForm && (
        <div style={{ marginBottom: 16 }}>
          <InstallmentAddForm onCreated={() => {
            setShowForm(false);
            loadRows(month);
            loadProjection();
            window.dispatchEvent(new Event('finance:dataChanged'));
          }} />
        </div>
      )}

      {error && (
        <div className="coin-codex-form" style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--rubric)', marginBottom: 8 }}>{t('common.somethingWentWrong')}</p>
          <button className="rpg-button" onClick={() => loadRows(month)}>{t('common.tryAgain')}</button>
        </div>
      )}

      {/* Installment list */}
      <Section title={`${t('coinify.installments', 'Cuotas')} (${rows.length})`} rightSlot={<HelpBubble variant="inline" text={t('coinify.installmentsHelp', 'Cuotas activas del mes. Cada fila muestra el monto, la cuota actual y las restantes.')} />}>
        {loading ? (
          <div className="coin-skeleton coin-skeleton--card" />
        ) : rows.length === 0 ? (
          <p className="coin-empty-codex">{t('coinify.noInstallments', 'No hay cuotas este mes')}</p>
        ) : (
          <div className="coin-installment-list">
            {groups.map((group) => (
              <div key={group.groupId} className="coin-installment-group">
                <div className="coin-installment-group__header">
                  <span className="coin-installment-group__title">
                    {group.description}
                  </span>
                  {(() => {
                    const first = parseInstallmentNumber(group.rows[0]);
                    return (
                      /* Era `flex: 1`: a pantalla completa la barra se estiraba
                         cientos de píxeles y abría el vacío entre título y monto. */
                      <div className="coin-installment-group__progress">
                        <Gauge value={first.current} max={first.total} tone={first.current === first.total ? 'sage' : 'gold'} showPips={false} />
                        {/* El rótulo del medidor es `--parch-0` sobre el riel:
                            encima del tramo vacío no se lee. Afuera, en tinta. */}
                        <span className="coin-installment-group__count">{first.current}/{first.total}</span>
                      </div>
                    );
                  })()}
                  {/* Mismo botón de borrado que el resto de Coinify, en vez de
                      un estilo inline propio. */}
                  <button
                    className="rpg-button coin-action-btn coin-action-btn--danger"
                    onClick={() => handleDeleteGroup(group.groupId)}
                    aria-label={t('coinify.deleteGroup', 'Eliminar grupo')}
                    title={t('coinify.deleteInstallmentGroup', 'Eliminar grupo de cuotas')}
                  >
                    <CrossMark style={{ width: '0.65em', height: '0.65em' }} />
                  </button>
                </div>
                {group.rows.map((row) => {
                  const { current, total } = parseInstallmentNumber(row);
                  const isComplete = current === total;

                  return (
                    <div
                      key={row.id}
                      className={`coin-installment-row ${isComplete ? 'coin-installment-row--complete' : ''}`}
                    >
                      {/* Sin `qb-small-caps`: ese util fija --fs-label y el
                          contador es el dato que ancla la fila. */}
                      <span className="coin-installment-row__counter">
                        {t('coinify.installmentCounter', `Cuota ${current}/${total}`, { current, total })}
                      </span>
                      <div className="coin-installment-row__right">
                        {!!row.forThirdParty && (
                          <Rune tone="gold">
                            <ArrowRight style={{ width: '0.75em', height: '0.75em' }} />
                            {' '}{row.thirdPartyName || t('coinify.thirdPartyUnknown', 'tercero')}
                          </Rune>
                        )}
                        <Gauge value={current} max={total} tone={isComplete ? 'sage' : 'gold'} showPips={false} />
                        {editingId === row.id ? (
                          /* Explicit confirm / cancel. Enter and Escape were the
                             only ways out, so a mouse user clicked away, saw the
                             field keep their number, and left convinced it saved. */
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <RpgNumberInput
                              value={editAmount}
                              onChange={setEditAmount}
                              min={0}
                              step={1}
                              autoFocus
                              style={{ width: 100 }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  saveInstallmentAmount(row.id, editAmount);
                                }
                                if (e.key === 'Escape') setEditingId(null);
                              }}
                            />
                            <button
                              className="rpg-button coin-action-btn coin-action-btn--confirm"
                              aria-label={t('coinify.save', 'Guardar')}
                              title={t('coinify.save', 'Guardar')}
                              onClick={() => saveInstallmentAmount(row.id, editAmount)}
                            ><Checkmark style={{ width: '0.8em', height: '0.8em' }} /></button>
                            <button
                              className="rpg-button coin-action-btn coin-action-btn--cancel"
                              aria-label={t('coinify.cancel', 'Cancelar')}
                              title={t('coinify.cancel', 'Cancelar')}
                              onClick={() => setEditingId(null)}
                            ><CrossMark style={{ width: '0.7em', height: '0.7em' }} /></button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            /* Sin `qb-numeral`: UnifrakturCook a 13 px sobre
                               pergamino texturado es ilegible para una cifra. */
                            className="coin-installment-row__amount coin-editable-amount"
                            title={t('coinify.clickToEdit', 'Click para editar')}
                            onClick={() => {
                              setEditingId(row.id);
                              setEditAmount(String(row.amount));
                            }}
                          >
                            {formatCurrency(row.amount, { currency: row.currency })}
                            <Pencil className="coin-editable-amount__pencil" style={{ width: '0.7em', height: '0.7em' }} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Month summary. The third figure is the sum the card bills you, not a
          net — third-party instalments get reimbursed, so calling it "neto"
          was simply wrong. */}
      {rows.length > 0 && (
        <>
          <div className="coin-installment-summary__head">
            <span className="qb-small-caps coin-installment-summary__title">
              {t('coinify.installmentSummary', 'RESUMEN DEL MES')}
            </span>
            <HelpBubble variant="inline" text={t('coinify.installmentSummaryHelp', 'Cuotas propias: lo que realmente pagás vos. De terceros: cargadas a tu tarjeta pero que te reintegran. Total facturado: lo que la tarjeta te cobra este mes.')} />
          </div>
          <div className="coin-installment-summary">
            <Cartouche label={t('coinify.ownInstallments', 'CUOTAS PROPIAS')} value={formatCurrency(totalOwn, { currency: 'ARS' })} />
            <Cartouche label={t('coinify.thirdPartyInstallments', 'DE TERCEROS')} value={formatCurrency(totalThirdParty, { currency: 'ARS' })} />
            <Cartouche label={t('coinify.billedInstallments', 'TOTAL FACTURADO')} value={formatCurrency(totalBilled, { currency: 'ARS' })} />
            {totalUsd > 0 && (
              <Cartouche label={t('coinify.usdInstallments', 'CUOTAS EN USD')} value={formatCurrency(totalUsd, { currency: 'USD' })} />
            )}
          </div>
        </>
      )}

      {/* 12-month projection chart */}
      {projection.length > 0 && (
        <Section title={t('coinify.installmentProjection', 'PROYECCION 12 MESES')} icon={<Compass width="12" height="12" style={{ color: 'var(--rubric)' }} />} rightSlot={<HelpBubble variant="inline" text={t('coinify.installmentProjectionHelp', 'Proyección de cuotas a 12 meses. Muestra cómo se distribuyen los compromisos futuros.')} />}>
          <div style={{ marginTop: 12 }}>
            <CastleBarChart data={barData} height={220} valueFormatter={(v) => {
              if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
              if (v >= 1_000) return `${Math.round(v / 1_000)}K`;
              return v.toLocaleString();
            }} />
          </div>
        </Section>
      )}
    </div>
  );
}
