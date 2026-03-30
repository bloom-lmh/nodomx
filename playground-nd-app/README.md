# playground-nd-app

A Vue-like NodomX demo project built with `.nd` single-file components.

## Commands

- `npm install`
- `npm run dev`
- `npm run build`

`npm run dev` starts Rollup watch mode and the built-in development server on `http://127.0.0.1:3000`.

## Project structure

```text
src/
  components/
    HeroCard.nd
    ProjectStructure.nd
  router/
    index.js
  views/
    HomeView.nd
    GuideView.nd
    AboutView.nd
  App.nd
  main.js
```

## Notes

- `App.nd` is the application shell, similar to a Vue root component.
- `src/views` contains route-level pages.
- `src/components` contains reusable building blocks.
- `src/router/index.js` registers the routes.
- `.nd` files support `template + script/script setup + style scoped`.

Open `http://127.0.0.1:3000` after `npm run dev` and the app will redirect `/` to `/home`.
