const fs = require('fs');
let code = fs.readFileSync('/app/applet/src/engine/watermarkEngine.js', 'utf8');

const search = `            img.src = src;`;
const replace = `            img.crossOrigin = 'anonymous';
            img.src = src;`;

code = code.replace(search, replace);

fs.writeFileSync('/app/applet/src/engine/watermarkEngine.js', code);
