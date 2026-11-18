import {
  addDaysToISODate,
  countDaysInclusive,
  formatDateForDisplay,
  getWeekBounds
} from './utils/date.js';
import { formatRupiah } from './utils/format.js';

function monthLabel(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return new Intl.DateTimeFormat('id-ID', {
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta'
  }).format(new Date(Date.UTC(year, month - 1, 15, 12)));
}

export function buildSpendingSeries(expenses, startDate, endDate) {
  const dayCount = countDaysInclusive(startDate, endDate);
  if (dayCount < 1) throw new RangeError('Rentang tanggal tidak valid.');

  const grouping = dayCount <= 31 ? 'day' : dayCount <= 180 ? 'week' : 'month';
  const totals = new Map();
  let firstBucket;
  let lastBucket;

  if (grouping === 'day') {
    firstBucket = startDate;
    lastBucket = endDate;
  } else if (grouping === 'week') {
    firstBucket = getWeekBounds(startDate).startDate;
    lastBucket = getWeekBounds(endDate).startDate;
  } else {
    firstBucket = `${startDate.slice(0, 7)}-01`;
    lastBucket = `${endDate.slice(0, 7)}-01`;
  }

  const bucketKeys = [];
  for (let cursor = firstBucket; cursor <= lastBucket;) {
    bucketKeys.push(cursor);
    totals.set(cursor, 0);
    if (grouping === 'day') {
      cursor = addDaysToISODate(cursor, 1);
    } else if (grouping === 'week') {
      cursor = addDaysToISODate(cursor, 7);
    } else {
      const [year, month] = cursor.split('-').map(Number);
      cursor = `${new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7)}-01`;
    }
  }

  for (const expense of expenses) {
    const bucket = grouping === 'day'
      ? expense.date
      : grouping === 'week'
        ? getWeekBounds(expense.date).startDate
        : expense.date.slice(0, 7) + '-01';
    totals.set(bucket, (totals.get(bucket) || 0) + expense.amount);
  }

  const labels = bucketKeys.map((key) => {
    if (grouping === 'month') return monthLabel(key.slice(0, 7));
    if (grouping === 'week') return `Minggu ${formatDateForDisplay(key)}`;
    return formatDateForDisplay(key);
  });

  return {
    labels,
    values: bucketKeys.map((key) => totals.get(key)),
    grouping
  };
}

export function createSpendingChart(canvas) {
  if (!globalThis.Chart) throw new Error('Chart.js belum berhasil dimuat.');
  const styles = getComputedStyle(document.documentElement);
  const accent = styles.getPropertyValue('--accent').trim() || '#237a52';
  const accentSoft = styles.getPropertyValue('--accent-soft').trim() || '#e7f4eb';

  return new globalThis.Chart(canvas, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Pengeluaran',
        data: [],
        borderColor: accent,
        backgroundColor: accentSoft,
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointHoverRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => formatRupiah(context.parsed.y)
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value) => formatRupiah(value)
          }
        }
      }
    }
  });
}

export function updateSpendingChart(chart, series) {
  const maximum = Math.max(0, ...series.values);
  const rawStep = maximum > 0 ? maximum / 4 : 1;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalizedStep = rawStep / magnitude;
  const step = normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 5 ? 5 : 10;

  chart.data.labels = series.labels;
  chart.data.datasets[0].data = series.values;
  chart.options.scales.y.ticks.stepSize = step * magnitude;
  chart.update();
}
