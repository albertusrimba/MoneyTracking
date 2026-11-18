import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSpendingSeries } from '../js/charts.js';
import { countDaysInclusive, getWeekBounds } from '../js/utils/date.js';

test('week boundaries run Monday through Sunday across month boundaries', () => {
  assert.deepEqual(getWeekBounds('2026-11-18'), {
    startDate: '2026-11-16',
    endDate: '2026-11-22'
  });
  assert.deepEqual(getWeekBounds('2026-03-01'), {
    startDate: '2026-02-23',
    endDate: '2026-03-01'
  });
});

test('inclusive date count includes leap days', () => {
  assert.equal(countDaysInclusive('2024-02-28', '2024-03-01'), 3);
});

test('daily series fills dates with zero spending', () => {
  const series = buildSpendingSeries([
    { date: '2026-11-16', amount: 100 },
    { date: '2026-11-22', amount: 500 }
  ], '2026-11-16', '2026-11-22');

  assert.equal(series.grouping, 'day');
  assert.deepEqual(series.values, [100, 0, 0, 0, 0, 0, 500]);
});

test('longer ranges group spending into weeks or months', () => {
  const weekly = buildSpendingSeries([
    { date: '2026-11-18', amount: 100 },
    { date: '2026-11-25', amount: 250 },
    { date: '2026-12-01', amount: 50 }
  ], '2026-11-16', '2026-12-27');
  assert.equal(weekly.grouping, 'week');
  assert.deepEqual(weekly.values.slice(0, 3), [100, 250, 50]);

  const monthly = buildSpendingSeries([
    { date: '2026-01-31', amount: 100 },
    { date: '2026-06-30', amount: 400 }
  ], '2026-01-01', '2026-07-01');
  assert.equal(monthly.grouping, 'month');
  assert.deepEqual(monthly.values, [100, 0, 0, 0, 0, 400, 0]);
});
