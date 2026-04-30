import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CastleBarChart } from '../../../shared/components/charts';
import type { BarDatum } from '../../../shared/components/charts';
import RpgNumberInput from '../../../shared/components/RpgNumberInput';
import { useToast } from '../../../shared/components/useToast';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import { MonthNavigator } from './shared/MonthNavigator';
import { AnimatedNumber } from './shared/AnimatedNumber';
import InstallmentAddForm from './shared/InstallmentAddForm';
import { Section, Gauge, Rune, Cartouche } from '../../../shared/components/codex/CodexPrimitives';
import { Compass } from '../../../shared/components/icons';
import HelpBubble from '../../../shared/components/HelpBubble';
import { formatCurrency } from '../utils/format';

interface InstallmentRow {
  id: string;
  description: string;
  amount: number;
  currency: string;
  category: string;
  installments: number;
  installmentCount?: number;
  installmentNumber?: number;
  installmentGroupId: string;
  forThirdParty?: string;
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
  const { t } = useTranslation();
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
      loadRows(month);
      loadProjection();
      window.dispatchEvent(new Event('finance:dataChanged'));
      toast({ type: 'coin', message: t('coinify.installmentGroupDeleted', 'Grupo de cuotas eliminado') });
    } catch (err) {
      console.error('[Installments] financeDeleteInstallmentGroup failed:', err);
      toast({ type: 'warning', message: t('coinify.deleteError', 'Error al eliminar') });
    }
  };

  const ownRows = rows.filter((r) => !r.forThirdParty);
  const thirdPartyRows = rows.filter((r) => !!r.forThirdParty);
  const totalOwn = ownRows.reduce((acc, r) => acc + r.amount, 0);
  const totalThirdParty = thirdPartyRows.reduce((acc, r) => acc + r.amount, 0);
  const net = totalOwn + totalThirdParty;

  const projectionLabel = (m: string) => {
    const [y, mo] = m.split('-').map(Number);
    return new Date(y, mo - 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
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
    <div>
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                        <Gauge value={first.current} max={first.total} tone={first.current === first.total ? 'sage' : 'gold'} showPips={false} label={`${first.current}/${first.total}`} />
                      </div>
                    );
                  })()}
                  <button
                    className="rpg-button"
                    onClick={() => handleDeleteGroup(group.groupId)}
                    title={t('coinify.deleteInstallmentGroup', 'Eliminar grupo de cuotas')}
                    style={{ padding: '2px 6px', fontSize: 'var(--fs-label)', color: 'var(--rubric)', opacity: 0.6 }}
                  >
                    {'\u2715'}
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
                      <span className="qb-small-caps coin-installment-row__counter">
                        {t('coinify.installmentCounter', `Cuota ${current}/${total}`, { current, total })}
                      </span>
                      <div className="coin-installment-row__right">
                        {row.forThirdParty && (
                          <Rune tone="gold">{'\u2192'} {row.forThirdParty}</Rune>
                        )}
                        <Gauge value={current} max={total} tone={isComplete ? 'sage' : 'gold'} showPips={false} />
                        {editingId === row.id ? (
                          <div
                            style={{ display: 'flex', gap: 4, alignItems: 'center' }}
                            onBlur={(e) => {
                              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                const val = parseFloat(editAmount);
                                if (val > 0) {
                                  window.api.financeUpdateInstallmentAmount(row.id, val).then(() => {
                                    setEditingId(null);
                                    loadRows(month);
                                    loadProjection();
                                    window.dispatchEvent(new Event('finance:dataChanged'));
                                  });
                                } else {
                                  setEditingId(null);
                                }
                              }
                            }}
                          >
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
                                  const val = parseFloat(editAmount);
                                  if (val > 0) {
                                    window.api.financeUpdateInstallmentAmount(row.id, val).then(() => {
                                      setEditingId(null);
                                      loadRows(month);
                                      loadProjection();
                                      window.dispatchEvent(new Event('finance:dataChanged'));
                                    });
                                  }
                                }
                                if (e.key === 'Escape') setEditingId(null);
                              }}
                            />
                          </div>
                        ) : (
                          <span
                            className="qb-numeral coin-installment-row__amount"
                            style={{ cursor: 'pointer' }}
                            title={t('coinify.clickToEdit', 'Click para editar')}
                            onClick={() => {
                              setEditingId(row.id);
                              setEditAmount(String(row.amount));
                            }}
                          >
                            {formatCurrency(row.amount)}
                          </span>
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

      {/* Month summary */}
      {rows.length > 0 && (
        <div className="coin-installment-summary">
          <HelpBubble text={t('coinify.installmentSummaryHelp', 'Resumen mensual de cuotas: propias, de terceros (cargadas a tu tarjeta) y el neto que pagás.')} />
          <Cartouche label={t('coinify.ownInstallments', 'CUOTAS PROPIAS')} value={formatCurrency(totalOwn)} />
          <Cartouche label={t('coinify.thirdPartyInstallments', 'DE TERCEROS')} value={formatCurrency(totalThirdParty)} />
          <Cartouche label={t('coinify.netInstallments', 'TOTAL NETO')} value={formatCurrency(net)} />
        </div>
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
