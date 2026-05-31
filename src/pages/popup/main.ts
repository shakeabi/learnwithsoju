import { mount } from 'svelte';
import './styles/tokens.css';
import App from './App.svelte';

const target = document.getElementById('lws-popup-root');
if (!target) {
  throw new Error('[lws] popup: #lws-popup-root not found');
}

mount(App, { target });
