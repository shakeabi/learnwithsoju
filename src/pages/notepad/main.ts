import { mount } from 'svelte';
// tokens.css @imports page-shell.css so both end up inlined into this
// entry's main.css — see styles/tokens.css for the why.
import './styles/tokens.css';
import App from './App.svelte';

const target = document.getElementById('lws-notepad-root');
if (!target) {
  throw new Error('[lws] notepad: #lws-notepad-root not found');
}

mount(App, { target });
