const fs = require('fs');
let code = fs.readFileSync('/app/applet/src/engine/watermarkEngine.js', 'utf8');

const search = `            img.onerror = (err) => reject(err);`;
const replace = `            img.onerror = (err) => reject(new Error(\`Failed to load image: \${src}\`));`;

code = code.replace(search, replace);

fs.writeFileSync('/app/applet/src/engine/watermarkEngine.js', code);
