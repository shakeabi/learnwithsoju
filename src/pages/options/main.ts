import { mount } from 'svelte';
import '$lib/styles/page-shell.css';
import './styles/tokens.css';
import App from './App.svelte';

const target = document.getElementById('lws-options-root');
if (!target) {
  throw new Error('[lws] options: #lws-options-root not found');
}

mount(App, { target });
