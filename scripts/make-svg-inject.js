// Инъекция загрузки SVG-разделителя в основной мир (известная методика)
import fs from "fs";
const svg64 = fs.readFileSync('/home/z/my-project/work/test-divider.svg').toString('base64');

const fn = `(function(){
  const b64 = "${svg64}";
  const input = document.querySelector('input[accept=".svg,image/svg+xml"]');
  if (!input) return 'no input';
  const byteStr = atob(b64);
  const bytes = new Uint8Array(byteStr.length);
  for (let i=0;i<byteStr.length;i++) bytes[i]=byteStr.charCodeAt(i);
  const file = new File([bytes], 'test-divider.svg', {type:'image/svg+xml'});
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', {bubbles:true}));
  return 'file set: ' + file.size + ' bytes';
})();`;

const script = `document.documentElement.appendChild(Object.assign(document.createElement('script'),{textContent:${JSON.stringify(fn)}})).remove();`;

fs.writeFileSync('/home/z/my-project/work/eval-svg.js', script);
console.log('written');
