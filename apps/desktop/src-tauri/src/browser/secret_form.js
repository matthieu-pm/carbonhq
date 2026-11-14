function (request, nonce) {
const target = request.target;
if (location.origin !== target.origin || location.protocol !== 'https:') return {ok:false};
const prepared = request.prepared;
if (request.action === 'submit' && (window.__carbonSecretDocument !== prepared.document || location.href !== prepared.url)) return {ok:false};
const find = selector => { const found = document.querySelectorAll(selector); return found.length === 1 ? found[0] : null; };
const button = find(target.submit);
if (!(button instanceof HTMLButtonElement || button instanceof HTMLInputElement) || button.type !== 'submit' || button.disabled || !button.checkVisibility()) return {ok:false};
const form = button.form;
if (!form || form.method.toLowerCase() !== 'post' || new URL(button.getAttribute('formaction') || form.action, location.href).origin !== target.origin) return {ok:false};
const fingerprint = JSON.stringify([form.action, form.method, button.getAttribute('formaction'), button.getAttribute('formmethod')]);
if (request.action === 'submit' && prepared.form !== fingerprint) return {ok:false};
const fields = target.fields.map(binding => ({ name:binding.name, el:find(binding.selector) }));
if (fields.some(({el}) => !(el instanceof HTMLInputElement) || !['text','password','email','tel'].includes(el.type) || el.form !== form || el.disabled || el.readOnly || !el.checkVisibility())) return {ok:false};
if (new Set(fields.map(({el}) => el)).size !== fields.length) return {ok:false};
if (request.action === 'prepare') {
  window.__carbonSecretDocument ??= nonce;
  return {ok:true,document:window.__carbonSecretDocument,url:location.href,form:fingerprint,label:(button.innerText || button.value || button.getAttribute('aria-label') || '').trim().slice(0,160)};
}
const clear = () => { for (const {el} of fields) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,''); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); } };
try {
  for (const {name,el} of fields) {
    el.style.webkitTextSecurity = 'disc';
    el.setAttribute('data-carbon-secret','');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,request.values[name]);
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  if (location.origin !== target.origin || window.__carbonSecretDocument !== prepared.document || !form.isConnected || !button.isConnected || fields.some(({el})=>!el.isConnected) || JSON.stringify([form.action,form.method,button.getAttribute('formaction'),button.getAttribute('formmethod')]) !== fingerprint || new URL(button.getAttribute('formaction') || form.action,location.href).origin !== target.origin) { clear(); return {ok:false}; }
  if ((button.getAttribute('formmethod') || form.method).toLowerCase() !== 'post' || !form.reportValidity()) { clear(); return {ok:false}; }
  form.requestSubmit(button);
  return {ok:true};
} catch (_) { clear(); return {ok:false}; }
}
