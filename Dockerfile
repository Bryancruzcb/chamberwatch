# One image for the whole app: the web app is built, copied into the jar's static resources, and served by the
# backend. Build it from the repository root with `docker build -t chamberwatch .`, or let compose.yaml build it.

FROM node:24-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM eclipse-temurin:21-jdk AS jar
WORKDIR /backend
# a checkout on Windows can drop the wrapper's executable bit or give it CRLF line ends
COPY backend/mvnw backend/pom.xml ./
COPY backend/.mvn .mvn
RUN sed -i 's/\r$//' mvnw && sh mvnw -B -ntp -q dependency:go-offline
COPY backend/src src
COPY --from=web /web/dist src/main/resources/static
RUN sh mvnw -B -ntp -q -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=jar /backend/target/chamberwatch.jar chamberwatch.jar
COPY docs/zenodo17122442.md5 docs/zenodo17122442.md5
# the bootstrap keeps the public files here; a named volume mounted on it takes this owner
RUN useradd --system --home-dir /app chamberwatch \
    && mkdir -p data/public/zenodo17122442 \
    && chown -R chamberwatch /app
USER chamberwatch
# a container memory limit bounds the heap; without one the JVM takes three quarters of the machine
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75"
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "chamberwatch.jar"]
