const fs = require('fs');
try {
  const buf = Buffer.from('{"a":1}');
  const res = JSON.parse(buf);
  fs.writeFileSync('result.txt', 'SUCCESS: ' + JSON.stringify(res));
} catch (e) {
  fs.writeFileSync('result.txt', 'ERROR: ' + e.message);
}
