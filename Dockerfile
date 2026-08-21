FROM python:3.12-alpine
WORKDIR /site
COPY *.html ./
CMD ["sh", "-c", "python3 -m http.server $PORT --bind ::"]
