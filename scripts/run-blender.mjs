#!/usr/bin/env node
// 以固定旗標執行 Blender 腳本，結束碼照傳。
// 用法：node scripts/run-blender.mjs <script.py> [script args…]
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const BLENDER = process.env.BLENDER_BIN || '/Applications/Blender.app/Contents/MacOS/Blender';
const [script, ...rest] = process.argv.slice(2);
if (!script) {
  console.error('用法：node scripts/run-blender.mjs <script.py> [script args…]');
  process.exit(2);
}
const args = [
  '--background',
  '--factory-startup',
  '--python-exit-code', '1',
  '--python', resolve(script),
  '--', ...rest,
];
const r = spawnSync(BLENDER, args, { stdio: 'inherit' });
if (r.error) {
  console.error(`無法執行 Blender：${r.error.message}`);
  process.exit(1);
}
process.exit(r.status ?? 1);
