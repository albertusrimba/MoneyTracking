import Dexie from '../lib/dexie.min.mjs';

export const db = new Dexie('catatan-pengeluaran');

// Version 1 is the starting schema; future shape changes go in a new version.
db.version(1).stores({
  categories: '&id, name, order',
  expenses: '++id, date, categoryId, [categoryId+date], createdAt',
  settings: '&key'
});

db.version(2).stores({
  categories: '&id, name, order',
  expenses: '++id, date, categoryId, [categoryId+date], createdAt, receiptId',
  settings: '&key',
  receipts: '++id, expenseId'
});

// Seed only a brand-new database so opening the app never overwrites user data.
db.on('populate', async () => {
  await db.categories.bulkAdd([
    { id: 'food', name: 'Makan', icon: '🍜', color: '#e9a23b', weeklyBudget: 0, order: 1, archived: false },
    { id: 'transport', name: 'Transport', icon: '🚌', color: '#5589d6', weeklyBudget: 0, order: 2, archived: false },
    { id: 'snacks', name: 'Jajan', icon: '🧋', color: '#b478c7', weeklyBudget: 0, order: 3, archived: false },
    { id: 'study', name: 'Kuliah', icon: '📚', color: '#36a786', weeklyBudget: 0, order: 4, archived: false },
    { id: 'bills', name: 'Tagihan', icon: '🧾', color: '#d46b68', weeklyBudget: 0, order: 5, archived: false },
    { id: 'shopping', name: 'Belanja', icon: '🛍️', color: '#dd8295', weeklyBudget: 0, order: 6, archived: false },
    { id: 'health', name: 'Kesehatan', icon: '💊', color: '#4b9baa', weeklyBudget: 0, order: 7, archived: false },
    { id: 'other', name: 'Lainnya', icon: '✨', color: '#85916e', weeklyBudget: 0, order: 8, archived: false }
  ]);
  await db.settings.bulkAdd([
    { key: 'weeklyIncomeAllowance', value: 0 },
    { key: 'weeklySavingsTarget', value: 0 },
    { key: 'weekStartsOn', value: 1 }
  ]);
});

export async function getActiveCategories() {
  const categories = await db.categories.toArray();
  return categories
    .filter((category) => !category.archived)
    .sort((a, b) => a.order - b.order);
}

export async function addExpense(expense, receiptBlob = null) {
  return db.transaction('rw', db.expenses, db.receipts, async () => {
    const expenseId = await db.expenses.add(expense);
    if (receiptBlob) {
      const receiptId = await db.receipts.add({
        expenseId,
        blob: receiptBlob,
        mimeType: receiptBlob.type,
        size: receiptBlob.size,
        createdAt: Date.now()
      });
      await db.expenses.update(expenseId, { receiptId });
    }
    return expenseId;
  });
}

export async function updateExpense(expense, { receiptBlob = null, removeReceipt = false } = {}) {
  return db.transaction('rw', db.expenses, db.receipts, async () => {
    if (expense.receiptId && (receiptBlob || removeReceipt)) {
      await db.receipts.delete(expense.receiptId);
      delete expense.receiptId;
    }
    if (receiptBlob) {
      expense.receiptId = await db.receipts.add({
        expenseId: expense.id,
        blob: receiptBlob,
        mimeType: receiptBlob.type,
        size: receiptBlob.size,
        createdAt: Date.now()
      });
    }
    return db.expenses.put(expense);
  });
}

export async function deleteExpense(id) {
  return db.transaction('rw', db.expenses, db.receipts, async () => {
    const expense = await db.expenses.get(id);
    if (expense?.receiptId) await db.receipts.delete(expense.receiptId);
    return db.expenses.delete(id);
  });
}

export async function restoreExpense(expense, receipt = null) {
  return db.transaction('rw', db.expenses, db.receipts, async () => {
    if (receipt) await db.receipts.put(receipt);
    return db.expenses.put(expense);
  });
}

export async function getReceipt(receiptId) {
  return receiptId ? db.receipts.get(receiptId) : null;
}

export async function getAllExpenses() {
  return db.expenses.toArray();
}
