# The official postgis/postgis images have no arm64 build, so install PostGIS on the arm64-capable postgres image.
FROM postgres:16-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-postgis-3 postgresql-16-postgis-3-scripts \
 && rm -rf /var/lib/apt/lists/*

COPY init/ /docker-entrypoint-initdb.d/
