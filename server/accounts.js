// Minimal account store (JSON file). V1 keeps profiles tiny: name, avatar, age confirmation.
// Swap for Supabase/Firebase auth later; the rest of the server only uses {id,name,avatar}.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cleanName } from './safety.js';

const FILE = process.env.ACCOUNTS_FILE || path.join(process.cwd(), 'data', 'accounts.json');
let db = { accounts: {} };
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* fresh */ }
let saveTimer;
const save = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(db)); } catch (e) { console.warn('[accounts] save failed', e.message); }
  }, 250);
};

export function createAccount({ name, avatar, ageOk }) {
  const n = cleanName(name);
  if (!n) throw new Error('Pick a name.');
  if (!ageOk) throw new Error('You must confirm you are 18 or older.');
  const id = randomBytes(6).toString('hex');
  const token = randomBytes(24).toString('hex');
  const acct = { id, token, name: n, avatar: String(avatar || '👽').slice(0, 8), ageOk: true, createdAt: Date.now() };
  db.accounts[token] = acct;
  save();
  return acct;
}

export const byToken = (t) => (t ? db.accounts[t] || null : null);

export function updateAccount(token, { name, avatar }) {
  const a = byToken(token);
  if (!a) return null;
  if (name) a.name = cleanName(name) || a.name;
  if (avatar) a.avatar = String(avatar).slice(0, 8);
  save();
  return a;
}

export const publicView = (a) => ({ id: a.id, name: a.name, avatar: a.avatar });
