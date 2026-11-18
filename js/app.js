import {
  addExpense,
  db,
  deleteExpense,
  getActiveCategories,
  getAllExpenses,
  getReceipt,
  restoreExpense,
  updateExpense
} from './db.js';
import {
  addDaysToISODate,
  countDaysInclusive,
  formatDateForDisplay,
  getWeekBounds,
  todayInJakarta
} from './utils/date.js';
import { formatRupiah } from './utils/format.js';
import { compressReceipt } from './utils/image.js';
import { buildSpendingSeries, createSpendingChart, updateSpendingChart } from './charts.js';
import { registerOfflineSupport } from './pwa.js';

const amountOutput = document.querySelector('#amount-output');
const categoryList = document.querySelector('#category-list');
const categoryHint = document.querySelector('#category-hint');
const dateInput = document.querySelector('#expense-date');
const noteInput = document.querySelector('#expense-note');
const receiptInput = document.querySelector('#receipt-image');
const receiptPreview = document.querySelector('#receipt-preview');
const receiptPreviewImage = document.querySelector('#receipt-preview-image');
const historyList = document.querySelector('#history-list');
const historySearch = document.querySelector('#history-search');
const historyMonthInput = document.querySelector('#history-month');
const saveButton = document.querySelector('#save-expense');
const expenseList = document.querySelector('#expense-list');
const expenseCount = document.querySelector('#expense-count');
const toast = document.querySelector('#toast');
const toastMessage = document.querySelector('#toast-message');
const undoButton = document.querySelector('#undo-button');
const entryView = document.querySelector('#entry-view');
const historyView = document.querySelector('#history-view');
const statsView = document.querySelector('#stats-view');
const statsPeriod = document.querySelector('#stats-period');
const statsCustomRange = document.querySelector('#stats-custom-range');
const statsStartDate = document.querySelector('#stats-start-date');
const statsEndDate = document.querySelector('#stats-end-date');
const statsError = document.querySelector('#stats-error');

let amountDigits = '';
let selectedCategoryId = '';
let editingExpenseId = null;
let categoriesById = new Map();
let expensesForHistory = [];
let receiptUrls = new Map();
let previewUrl = '';
let pendingReceiptBlob = null;
let removeExistingReceipt = false;
let isProcessingReceipt = false;
let undoAction = null;
let toastTimer;
let spendingChart = null;

function showToast(message, action = null) {
  window.clearTimeout(toastTimer);
  undoAction = action;
  toastMessage.textContent = message;
  undoButton.hidden = !action;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
    undoAction = null;
  }, 5000);
}

function updateFormState() {
  const amount = Number(amountDigits || 0);
  amountOutput.textContent = formatRupiah(amount);
  saveButton.disabled = !Number.isSafeInteger(amount) || amount <= 0 || !selectedCategoryId || !dateInput.value || isProcessingReceipt;
  saveButton.textContent = editingExpenseId === null ? 'Simpan pengeluaran' : 'Simpan perubahan';
  categoryHint.textContent = selectedCategoryId ? 'Kategori dipilih' : 'Pilih satu';
}

function renderCategories(categories) {
  categoryList.replaceChildren();
  categoriesById = new Map(categories.map((category) => [category.id, category]));

  for (const category of categories) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'category-button';
    button.setAttribute('aria-pressed', String(category.id === selectedCategoryId));

    const icon = document.createElement('span');
    icon.className = 'category-icon';
    icon.textContent = category.icon;
    const name = document.createElement('span');
    name.className = 'category-name';
    name.textContent = category.name;
    button.append(icon, name);

    button.addEventListener('click', () => {
      selectedCategoryId = category.id;
      renderCategories(categories);
      updateFormState();
    });
    categoryList.append(button);
  }
}

function renderExpenses(expenses) {
  expenseList.replaceChildren();
  expenseCount.textContent = `${expenses.length} transaksi`;

  if (!expenses.length) {
    const emptyState = document.createElement('p');
    emptyState.className = 'empty-state';
    emptyState.textContent = 'Belum ada transaksi. Catat pengeluaran pertamamu di atas.';
    expenseList.append(emptyState);
    return;
  }

  for (const expense of expenses) {
    const category = categoriesById.get(expense.categoryId);
    const row = document.createElement('article');
    row.className = 'expense-row';

    const receiptUrl = receiptUrls.get(expense.receiptId);
    const icon = document.createElement(receiptUrl ? 'img' : 'span');
    icon.className = 'expense-icon';
    if (receiptUrl) {
      icon.classList.add('expense-thumbnail');
      icon.src = receiptUrl;
      icon.alt = `Bukti pembayaran: ${expense.note || category?.name || 'transaksi'}`;
      icon.addEventListener('click', () => openReceipt(expense, receiptUrl));
    } else {
      icon.textContent = category?.icon || '📦';
    }
    const details = document.createElement('div');
    details.className = 'expense-details';
    const title = document.createElement('p');
    title.className = 'expense-title';
    title.textContent = expense.note || category?.name || 'Kategori diarsipkan';
    const meta = document.createElement('p');
    meta.className = 'expense-meta';
    meta.textContent = `${category?.name || 'Kategori diarsipkan'} · ${formatDateForDisplay(expense.date)}`;
    details.append(title, meta);

    const amount = document.createElement('p');
    amount.className = 'expense-amount';
    amount.textContent = formatRupiah(expense.amount);

    const actions = document.createElement('div');
    actions.className = 'expense-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = 'Edit';
    edit.setAttribute('aria-label', `Edit ${expense.note || category?.name || 'transaksi'}`);
    edit.addEventListener('click', () => {
      beginEdit(expense).catch((error) => {
        console.error('Gagal membuka transaksi untuk edit:', error);
        showToast('Transaksi gagal dibuka untuk diedit.');
      });
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'delete-button';
    remove.textContent = 'Hapus';
    remove.setAttribute('aria-label', `Hapus ${expense.note || category?.name || 'transaksi'}`);
    remove.addEventListener('click', () => {
      removeExpense(expense).catch((error) => {
        console.error('Gagal menghapus transaksi:', error);
        showToast('Transaksi gagal dihapus. Coba lagi.');
      });
    });
    actions.append(edit, remove);

    row.append(icon, details, amount, actions);
    expenseList.append(row);
  }
}

function formatMonthLabel(monthValue) {
  const [year, month] = monthValue.split('-').map(Number);
  return new Intl.DateTimeFormat('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta'
  }).format(new Date(Date.UTC(year, month - 1, 15, 12)));
}

function renderHistory() {
  const monthValue = historyMonthInput.value;
  const monthLabel = formatMonthLabel(monthValue);
  document.querySelector('#history-heading').textContent = monthLabel;
  document.querySelector('#history-month-label').textContent = monthLabel;

  const query = historySearch.value.trim().toLocaleLowerCase('id-ID');
  const matchingExpenses = expensesForHistory.filter((expense) => {
    if (!expense.date.startsWith(monthValue)) return false;
    if (!query) return true;
    const category = categoriesById.get(expense.categoryId);
    const searchable = `${expense.note || ''} ${category?.name || ''} ${expense.amount} ${expense.date}`.toLocaleLowerCase('id-ID');
    return searchable.includes(query);
  });

  const monthTotal = matchingExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  document.querySelector('#history-summary').textContent =
    `${matchingExpenses.length} transaksi · ${formatRupiah(monthTotal)}${query ? ' cocok dengan pencarian' : ' bulan ini'}`;
  historyList.replaceChildren();

  if (!matchingExpenses.length) {
    const emptyState = document.createElement('p');
    emptyState.className = 'empty-state';
    emptyState.textContent = query ? 'Tidak ada transaksi yang cocok.' : 'Belum ada transaksi di bulan ini.';
    historyList.append(emptyState);
    return;
  }

  const byDate = new Map();
  for (const expense of matchingExpenses) {
    if (!byDate.has(expense.date)) byDate.set(expense.date, []);
    byDate.get(expense.date).push(expense);
  }

  for (const [date, dayExpenses] of byDate) {
    const group = document.createElement('section');
    group.className = 'history-day';
    const heading = document.createElement('h3');
    heading.textContent = formatDateForDisplay(date);
    const cards = document.createElement('div');
    cards.className = 'history-cards';

    for (const expense of dayExpenses) {
      const category = categoriesById.get(expense.categoryId);
      const card = document.createElement('article');
      card.className = 'history-card';
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.className = 'history-card-preview';
      preview.setAttribute('aria-label', expense.receiptId ? 'Buka bukti pembayaran' : 'Transaksi tanpa foto');
      const receiptUrl = receiptUrls.get(expense.receiptId);
      if (receiptUrl) {
        const image = document.createElement('img');
        image.src = receiptUrl;
        image.alt = '';
        preview.append(image);
        preview.addEventListener('click', () => openReceipt(expense, receiptUrl));
      } else {
        preview.disabled = true;
        const noImage = document.createElement('span');
        noImage.className = 'history-no-image';
        noImage.textContent = category?.icon || '🧾';
        preview.append(noImage);
      }

      const title = document.createElement('h4');
      title.textContent = expense.note || category?.name || 'Pengeluaran';
      const amount = document.createElement('p');
      amount.className = 'history-card-amount';
      amount.textContent = formatRupiah(expense.amount);
      const meta = document.createElement('p');
      meta.className = 'history-card-meta';
      meta.textContent = category?.name || 'Kategori diarsipkan';
      card.append(preview, title, amount, meta);
      cards.append(card);
    }
    group.append(heading, cards);
    historyList.append(group);
  }
}

function getSelectedStatsRange() {
  const today = todayInJakarta();
  if (statsPeriod.value === 'custom') {
    return { startDate: statsStartDate.value, endDate: statsEndDate.value };
  }

  const thisWeek = getWeekBounds(today);
  if (statsPeriod.value === 'last-week') {
    const startDate = addDaysToISODate(thisWeek.startDate, -7);
    return { startDate, endDate: addDaysToISODate(startDate, 6) };
  }
  return thisWeek;
}

function renderStats() {
  const { startDate, endDate } = getSelectedStatsRange();
  statsCustomRange.hidden = statsPeriod.value !== 'custom';

  if (!startDate || !endDate || startDate > endDate) {
    statsError.textContent = 'Tanggal awal harus sama dengan atau sebelum tanggal akhir.';
    statsError.hidden = false;
    document.querySelector('.chart-card').hidden = true;
    document.querySelector('#stats-period-label').textContent = 'Periksa rentang tanggal';
    document.querySelector('#stats-total').textContent = '—';
    document.querySelector('#stats-expense-count').textContent = '—';
    document.querySelector('#stats-daily-average').textContent = '—';
    if (spendingChart) updateSpendingChart(spendingChart, { labels: [], values: [] });
    return;
  }

  statsError.hidden = true;
  document.querySelector('.chart-card').hidden = false;
  const dayCount = countDaysInclusive(startDate, endDate);
  const matchingExpenses = expensesForHistory.filter(
    (expense) => expense.date >= startDate && expense.date <= endDate
  );
  const total = matchingExpenses.reduce((sum, expense) => sum + expense.amount, 0);

  document.querySelector('#stats-period-label').textContent =
    `${formatDateForDisplay(startDate)} – ${formatDateForDisplay(endDate)}`;
  document.querySelector('#stats-total').textContent = formatRupiah(total);
  document.querySelector('#stats-expense-count').textContent =
    `${matchingExpenses.length} transaksi`;
  document.querySelector('#stats-daily-average').textContent =
    `Rata-rata ${formatRupiah(Math.round(total / dayCount))}/hari`;

  const series = buildSpendingSeries(matchingExpenses, startDate, endDate);
  document.querySelector('#chart-period-note').textContent = {
    day: 'Jumlah pengeluaran per hari',
    week: 'Jumlah pengeluaran per minggu',
    month: 'Jumlah pengeluaran per bulan'
  }[series.grouping];
  if (!spendingChart) {
    spendingChart = createSpendingChart(document.querySelector('#spending-chart'));
  }
  updateSpendingChart(spendingChart, series);
}

async function refreshExpenses() {
  for (const url of receiptUrls.values()) URL.revokeObjectURL(url);
  receiptUrls.clear();
  expensesForHistory = (await getAllExpenses())
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const receiptIds = expensesForHistory.map((expense) => expense.receiptId).filter(Boolean);
  const receipts = await db.receipts.bulkGet(receiptIds);
  for (const receipt of receipts) {
    if (receipt) receiptUrls.set(receipt.id, URL.createObjectURL(receipt.blob));
  }
  renderExpenses(expensesForHistory.slice(0, 10));
  renderHistory();
  if (!statsView.hidden) renderStats();
}

function resetForm() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = '';
  amountDigits = '';
  selectedCategoryId = '';
  editingExpenseId = null;
  pendingReceiptBlob = null;
  removeExistingReceipt = false;
  isProcessingReceipt = false;
  receiptInput.value = '';
  receiptPreview.hidden = true;
  dateInput.value = todayInJakarta();
  noteInput.value = '';
  renderCategories([...categoriesById.values()]);
  updateFormState();
}

async function showReceiptPreview(blob) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  receiptPreviewImage.src = previewUrl;
  receiptPreview.hidden = false;
}

async function beginEdit(expense) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = '';
  amountDigits = String(expense.amount);
  selectedCategoryId = expense.categoryId;
  editingExpenseId = expense.id;
  pendingReceiptBlob = null;
  removeExistingReceipt = false;
  dateInput.value = expense.date;
  noteInput.value = expense.note || '';
  document.querySelector('#entry-heading').textContent = 'Edit pengeluaran';
  if (expense.receiptId) {
    const receipt = await getReceipt(expense.receiptId);
    if (receipt) await showReceiptPreview(receipt.blob);
  } else {
    receiptPreview.hidden = true;
  }
  renderCategories([...categoriesById.values()]);
  updateFormState();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function removeExpense(expense) {
  const receipt = expense.receiptId ? await getReceipt(expense.receiptId) : null;
  await deleteExpense(expense.id);
  await refreshExpenses();
  showToast('Transaksi dihapus.', async () => {
    await restoreExpense(expense, receipt);
    await refreshExpenses();
    showToast('Transaksi dikembalikan.');
  });
}

function openReceipt(expense, url) {
  document.querySelector('#receipt-dialog-image').src = url;
  document.querySelector('#receipt-dialog-caption').textContent =
    `${expense.note || categoriesById.get(expense.categoryId)?.name || 'Pengeluaran'} · ${formatRupiah(expense.amount)}`;
  document.querySelector('#receipt-dialog').showModal();
}

function setHistoryMonth(value) {
  historyMonthInput.value = value;
  renderHistory();
}

document.querySelector('#history-tab').addEventListener('click', () => {
  entryView.hidden = true;
  historyView.hidden = false;
  statsView.hidden = true;
  document.querySelector('#entry-tab').setAttribute('aria-pressed', 'false');
  document.querySelector('#history-tab').setAttribute('aria-pressed', 'true');
  document.querySelector('#stats-tab').setAttribute('aria-pressed', 'false');
  renderHistory();
});

document.querySelector('#entry-tab').addEventListener('click', () => {
  entryView.hidden = false;
  historyView.hidden = true;
  statsView.hidden = true;
  document.querySelector('#entry-tab').setAttribute('aria-pressed', 'true');
  document.querySelector('#history-tab').setAttribute('aria-pressed', 'false');
  document.querySelector('#stats-tab').setAttribute('aria-pressed', 'false');
});

document.querySelector('#stats-tab').addEventListener('click', () => {
  entryView.hidden = true;
  historyView.hidden = true;
  statsView.hidden = false;
  document.querySelector('#entry-tab').setAttribute('aria-pressed', 'false');
  document.querySelector('#history-tab').setAttribute('aria-pressed', 'false');
  document.querySelector('#stats-tab').setAttribute('aria-pressed', 'true');
  renderStats();
});

historySearch.addEventListener('input', renderHistory);
historyMonthInput.addEventListener('change', renderHistory);
statsPeriod.addEventListener('change', () => {
  if (statsPeriod.value === 'custom' && !statsStartDate.value && !statsEndDate.value) {
    const currentWeek = getWeekBounds(todayInJakarta());
    statsStartDate.value = currentWeek.startDate;
    statsEndDate.value = todayInJakarta();
  }
  renderStats();
});
statsStartDate.addEventListener('change', renderStats);
statsEndDate.addEventListener('change', renderStats);

for (const [selector, offset] of [['#previous-month', -1], ['#next-month', 1]]) {
  document.querySelector(selector).addEventListener('click', () => {
    const [year, month] = historyMonthInput.value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1 + offset, 15, 12));
    setHistoryMonth(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`);
  });
}

receiptInput.addEventListener('change', async () => {
  const file = receiptInput.files?.[0];
  if (!file) return;
  isProcessingReceipt = true;
  receiptInput.disabled = true;
  updateFormState();
  try {
    pendingReceiptBlob = await compressReceipt(file);
    removeExistingReceipt = false;
    await showReceiptPreview(pendingReceiptBlob);
    showToast('Foto diperkecil dan siap disimpan.');
  } catch (error) {
    console.error('Gagal memproses bukti pembayaran:', error);
    receiptInput.value = '';
    showToast(error.message || 'Foto gagal diproses.');
  } finally {
    isProcessingReceipt = false;
    receiptInput.disabled = false;
    updateFormState();
  }
});

document.querySelector('#remove-receipt').addEventListener('click', () => {
  pendingReceiptBlob = null;
  removeExistingReceipt = editingExpenseId !== null;
  isProcessingReceipt = false;
  receiptInput.value = '';
  receiptPreview.hidden = true;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = '';
});

document.querySelector('#close-receipt-dialog').addEventListener('click', () => {
  document.querySelector('#receipt-dialog').close();
});

document.querySelector('#keypad').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;

  if (button.dataset.digit !== undefined) {
    if (amountDigits.length < 12) amountDigits += button.dataset.digit;
  } else if (button.dataset.action === 'clear') {
    amountDigits = '';
  } else if (button.dataset.action === 'backspace') {
    amountDigits = amountDigits.slice(0, -1);
  }
  updateFormState();
});

dateInput.addEventListener('change', updateFormState);

saveButton.addEventListener('click', async () => {
  const amount = Number(amountDigits);
  if (!Number.isSafeInteger(amount) || amount <= 0 || !selectedCategoryId || !dateInput.value) return;

  const expense = {
    amount,
    categoryId: selectedCategoryId,
    note: noteInput.value.trim(),
    date: dateInput.value,
    createdAt: Date.now()
  };

  saveButton.disabled = true;
  try {
    if (editingExpenseId !== null) {
      expense.id = editingExpenseId;
      const previousExpense = await db.expenses.get(editingExpenseId);
      if (!previousExpense) throw new Error('Transaksi yang diedit tidak ditemukan.');
      expense.createdAt = previousExpense.createdAt;
      expense.receiptId = previousExpense.receiptId;
      await updateExpense(expense, {
        receiptBlob: pendingReceiptBlob,
        removeReceipt: removeExistingReceipt
      });
      showToast('Perubahan transaksi disimpan.');
    } else {
      const id = await addExpense(expense, pendingReceiptBlob);
      showToast('Pengeluaran tersimpan.', async () => {
        await deleteExpense(id);
        await refreshExpenses();
        showToast('Transaksi terakhir diurungkan.');
      });
    }
  } catch (error) {
    console.error('Gagal menyimpan transaksi:', error);
    showToast('Transaksi gagal disimpan. Coba lagi.');
    updateFormState();
    return;
  }

  document.querySelector('#entry-heading').textContent = 'Pengeluaran baru';
  resetForm();
  try {
    await refreshExpenses();
  } catch (error) {
    console.error('Transaksi tersimpan, tetapi daftar gagal dimuat:', error);
    showToast('Tersimpan, tetapi daftar transaksi gagal dimuat.');
  }
});

undoButton.addEventListener('click', async () => {
  if (!undoAction) return;
  const action = undoAction;
  undoAction = null;
  window.clearTimeout(toastTimer);
  toast.hidden = true;
  try {
    await action();
  } catch (error) {
    console.error('Gagal mengurungkan perubahan:', error);
    showToast('Tidak bisa mengurungkan perubahan. Coba lagi.');
  }
});

async function startApp() {
  registerOfflineSupport(document.querySelector('#offline-status'));
  await db.open();
  const categories = await getActiveCategories();
  renderCategories(categories);
  dateInput.value = todayInJakarta();
  historyMonthInput.value = todayInJakarta().slice(0, 7);
  const currentWeek = getWeekBounds(todayInJakarta());
  statsStartDate.value = currentWeek.startDate;
  statsEndDate.value = todayInJakarta();
  updateFormState();
  await refreshExpenses();
}

startApp().catch((error) => {
  console.error('Gagal membuka database pengeluaran:', error);
  showToast('Database tidak bisa dibuka. Coba muat ulang aplikasi.');
});
