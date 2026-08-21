FROM python:3.12-alpine
WORKDIR /site
COPY *.html server.py ./
EXPOSE 8080
CMD ["python3", "server.py"]
