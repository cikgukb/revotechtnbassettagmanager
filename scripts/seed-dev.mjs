// Seed untuk pembangunan TEMPATAN sahaja: satu akaun bagi setiap role.
// Guna: npm run seed:dev   (jangan jalankan pada pangkalan data sebenar)
import { writeFileSync } from 'node:fs';
import { hashPassword } from '../shared/password.ts';

export const DEV_PASSWORD = 'Revotech#2026';
const t = new Date().toISOString();
const hash = await hashPassword(DEV_PASSWORD);
const q = (v) => (v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const zone = "(SELECT id FROM zones WHERE name = 'SHAH ALAM')";
const team = (name) => `(SELECT id FROM teams WHERE name = '${name}' AND zone_id = ${zone})`;

const users = [
  ['superadmin', 'Super Admin', 'super_admin', 'NULL', 'NULL'],
  ['admin.sa', 'Admin Shah Alam', 'admin', zone, 'NULL'],
  ['admin2.sa', 'Admin Kedua Shah Alam', 'admin', zone, 'NULL'],
  ['op.alpha', 'Operator Alpha', 'operator', zone, team('ALPHA')],
  ['op.bravo', 'Operator Bravo', 'operator', zone, team('BRAVO')],
  ['viewer.sa', 'Viewer Shah Alam', 'viewer', zone, 'NULL'],
];
const sql = [
  `INSERT INTO zones (name, created_at) VALUES ('SHAH ALAM', ${q(t)}) ON CONFLICT(name) DO NOTHING;`,
  `INSERT INTO zones (name, created_at) VALUES ('KL UTARA', ${q(t)}) ON CONFLICT(name) DO NOTHING;`,
  ...['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA'].map((n) => `INSERT INTO teams (zone_id, name, created_at) VALUES (${zone}, '${n}', ${q(t)}) ON CONFLICT(zone_id, name) DO NOTHING;`),
  ...users.map(
    ([username, name, role, z, tm]) =>
      `INSERT INTO users (username, name, password_hash, role, zone_id, team_id, active, must_change_password, created_at) VALUES (${q(username)}, ${q(name)}, ${q(hash)}, ${q(role)}, ${z}, ${tm}, 1, 0, ${q(t)}) ON CONFLICT(username) DO NOTHING;`,
  ),
];
const out = process.argv[2] ?? '.wrangler/seed-dev.sql';
writeFileSync(out, sql.join('\n') + '\n');
console.log(`Ditulis: ${out} (kata laluan dev: ${DEV_PASSWORD})`);
