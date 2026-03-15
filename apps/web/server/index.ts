import { app } from "../../api/src/server";

const port = Number(process.env.API_PORT ?? 8787);

app.listen(port, () => {
  console.log(`[apps-web compat-api] listening on http://localhost:${port}`);
});
