import app from "../api/index.js";

const port = Number(process.env.PORT || 3000);
const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Ienvia container listening on 0.0.0.0:${port}`);
});

server.on("error", (error) => {
  console.error("Ienvia container server error:", error);
  process.exit(1);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
