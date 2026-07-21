import { ViteSSG } from 'vite-ssg';
import App from './App.vue';
import { routes } from './router';
import './styles.css';

export const createApp = ViteSSG(
  App,
  {
    routes,
    scrollBehavior(_to, _from, savedPosition) {
      return savedPosition || { top: 0 };
    },
  },
);
