# Railway (or any Docker host): build the pages, then serve the folder with Caddy.
FROM python:3.12-slim AS build
WORKDIR /site
COPY . .
RUN python3 build.py

FROM caddy:2-alpine
COPY --from=build /site /srv
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "caddy file-server --root /srv --listen :${PORT}"]
