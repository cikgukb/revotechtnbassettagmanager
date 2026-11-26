// Jana hash kata laluan untuk dimasukkan terus ke jadual `users`.
// Guna: npm run hash -- "KataLaluanSementara123"
import { hashPassword, passwordProblem } from '../shared/password.ts';

const pw = process.argv[2];
if (!pw) {
  console.error('Guna: npm run hash -- "<kata laluan>"');
  process.exit(1);
}
const problem = passwordProblem(pw);
if (problem) {
  console.error(problem);
  process.exit(1);
}
console.log(await hashPassword(pw));
