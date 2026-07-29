"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
exports.router = (0, express_1.Router)();
exports.router.get('/', auth_1.authenticate, auth_1.requireOperator, async (req, res) => {
    try {
        const expenses = await db_1.default.expense.findMany({
            where: { operatorId: req.user.id },
            orderBy: { createdAt: 'desc' },
        });
        return res.json(expenses);
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
exports.router.post('/', auth_1.authenticate, auth_1.requireOperator, async (req, res) => {
    const { label, amount, tripId, category } = req.body;
    if (!label || amount == null)
        return res.status(400).json({ message: 'Missing label or amount' });
    try {
        const expense = await db_1.default.expense.create({
            data: {
                operatorId: req.user.id,
                label,
                category: category || 'OTHER',
                amount: parseFloat(amount),
                tripId: tripId || null,
            },
        });
        return res.status(201).json(expense);
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
exports.router.delete('/:id', auth_1.authenticate, auth_1.requireOperator, async (req, res) => {
    try {
        const expense = await db_1.default.expense.findUnique({ where: { id: req.params.id } });
        if (!expense)
            return res.status(404).json({ message: 'Expense not found' });
        if (expense.operatorId !== req.user.id)
            return res.status(403).json({ message: 'Forbidden' });
        await db_1.default.expense.delete({ where: { id: req.params.id } });
        return res.json({ message: 'Deleted' });
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
