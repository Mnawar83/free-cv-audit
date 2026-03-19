# Free CV Audit

## Performance checks (Lighthouse + Core Web Vitals)

Use Chrome Lighthouse after deploying preview changes:

1. Open the page in Chrome.
2. Open DevTools → **Lighthouse**.
3. Run **Mobile** and **Desktop** audits with **Performance** selected.
4. Compare the report before/after changes.

### What to watch

- **LCP (Largest Contentful Paint):** how quickly the main content appears.  
  Target: **≤ 2.5s**.
- **INP (Interaction to Next Paint):** responsiveness after user input.  
  Target: **≤ 200ms**.
- **CLS (Cumulative Layout Shift):** visual stability as content loads.  
  Target: **≤ 0.1**.

### Interpreting results

- If **LCP** is high, prioritize reducing render-blocking resources and optimizing media.
- If **INP** is high, reduce long-running JavaScript work on the main thread.
- If **CLS** is high, reserve dimensions for images/components and avoid layout jumps.

