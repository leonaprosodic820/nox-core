'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DESIGNS_DIR = path.join(__dirname, 'knowledge', 'designs');
fs.mkdirSync(DESIGNS_DIR, { recursive: true });

async function generateDesign(description, opts = {}) {
  const type = opts.type || 'logo';
  const name = opts.name || `design_${Date.now()}`;
  const svgPath = path.join(DESIGNS_DIR, `${name}.svg`);
  const pngPath = path.join(DESIGNS_DIR, `${name}.png`);

  const prompt = `Crée un ${type} SVG professionnel pour: "${description}"
RÈGLES: SVG autonome viewBox="0 0 400 400", pas de polices externes, couleurs pro harmonieuses, design moderne minimaliste.
Sauvegarde UNIQUEMENT le fichier SVG dans: ${svgPath}`;

  const ccBridge = require('./claude-code-bridge');
  const result = await ccBridge.runClaudeCode(prompt, { cwd: DESIGNS_DIR, timeout: 60000 });

  if (!fs.existsSync(svgPath)) {
    const m = result.output.match(/<svg[\s\S]*?<\/svg>/i);
    if (m) fs.writeFileSync(svgPath, m[0]);
    else return { error: 'SVG non généré', output: result.output.slice(0, 200) };
  }

  try { execSync(`rsvg-convert -w 1024 -h 1024 "${svgPath}" -o "${pngPath}"`, { timeout: 10000 }); }
  catch (e) { try { execSync(`qlmanage -t -s 1024 -o "${DESIGNS_DIR}" "${svgPath}"`, { timeout: 10000, stdio: 'ignore' }); const ql = svgPath + '.png'; if (fs.existsSync(ql)) fs.renameSync(ql, pngPath); } catch (e2) {} }

  return { success: true, svgPath, pngPath: fs.existsSync(pngPath) ? pngPath : null, svgContent: fs.readFileSync(svgPath, 'utf8') };
}

async function listDesigns() {
  return fs.readdirSync(DESIGNS_DIR).filter(f => f.endsWith('.svg') || f.endsWith('.png'))
    .map(f => ({ name: f, path: path.join(DESIGNS_DIR, f), size: fs.statSync(path.join(DESIGNS_DIR, f)).size, date: fs.statSync(path.join(DESIGNS_DIR, f)).mtime }))
    .sort((a, b) => b.date - a.date).slice(0, 20);
}

module.exports = { generateDesign, listDesigns, DESIGNS_DIR };
