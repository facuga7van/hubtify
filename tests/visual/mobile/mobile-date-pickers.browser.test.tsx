/**
 * GEN-02 (QA 0.9.0): en el teléfono «aceptar lo que muestra» es el gesto
 * natural, y el botón OK de los pickers cerraba sin emitir el valor visible:
 * el campo quedaba en «Seleccionar fecha» y el setup de Nutrify no avanzaba.
 */
import { describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import RpgDatePicker from '@shared/components/RpgDatePicker';
import RpgDateTimePicker from '@shared/components/RpgDateTimePicker';

import '../../../src/i18n';
import '../../../src/hub/styles/theme.css';
import '../../../src/hub/styles/components.css';

const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

describe('Pickers — OK emite el valor visible (GEN-02)', () => {
  test('RpgDatePicker: OK sin tocar los selects emite la fecha que muestra', async () => {
    const onChange = vi.fn();
    render(<RpgDatePicker value="" onChange={onChange} />);
    await page.getByRole('button', { name: /Seleccionar fecha|Select date/i }).click();
    await settle();
    await page.getByRole('button', { name: 'OK' }).click();
    await settle();
    const expected = `${new Date().getFullYear() - 25}-01-01`;
    expect(onChange).toHaveBeenCalledWith(expected);
    expect(document.querySelector('.rpg-anchored-popup')).toBeNull();
  });

  test('RpgDateTimePicker: OK sin tocar los selects emite fecha y hora visibles', async () => {
    const onChange = vi.fn();
    render(<RpgDateTimePicker value="" onChange={onChange} />);
    await page.getByRole('button', { name: /Seleccionar|Select/i }).click();
    await settle();
    await page.getByRole('button', { name: 'OK' }).click();
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(onChange).toHaveBeenCalledWith(
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:00`,
    );
    expect(document.querySelector('.rpg-anchored-popup')).toBeNull();
  });
});
