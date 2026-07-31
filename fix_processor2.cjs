const fs = require('fs');
let code = fs.readFileSync('/app/applet/src/engine/processor.ts', 'utf8');

// fix type assertions
code = code.replace(/firstSampleResult\.value;/g, 'firstSampleResult.value as any;');
code = code.replace(/const sample of getSamples\(\)/g, 'const sample of getSamples() as any');
code = code.replace(/await websr\.render\(canvas\);/g, 'const bmp = await createImageBitmap(canvas);\n            await websr.render(bmp as any);\n            bmp.close();');

fs.writeFileSync('/app/applet/src/engine/processor.ts', code);
