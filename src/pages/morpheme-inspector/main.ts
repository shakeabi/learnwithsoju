import { mount } from 'svelte';
// tokens.css @imports page-shell.css so both end up inlined into this
// entry's main.css — see styles/tokens.css for the why.
import './styles/tokens.css';
import App from './App.svelte';

const target = document.getElementById('lws-inspector-root');
if (!target) {
  throw new Error('[lws] morpheme-inspector: #lws-inspector-root not found');
}

mount(App, { target });
