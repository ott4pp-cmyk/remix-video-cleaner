const fs = require('fs');
let code = fs.readFileSync('/app/applet/src/engine/watermarkEngine.js', 'utf8');

code = code.replace("            img.crossOrigin = 'anonymous';\n            img.src = src;", "            img.src = src;");

fs.writeFileSync('/app/applet/src/engine/watermarkEngine.js', code);
