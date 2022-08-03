FROM python:3-alpine
WORKDIR /usr/src/app
RUN adduser -D worker
USER worker
EXPOSE 80
ENV PATH="/home/worker/.local/bin:${PATH}"
RUN pip install pipenv
COPY --chown=worker:worker Pipfile .
COPY --chown=worker:worker Pipfile.lock .
RUN pipenv install --ignore-pipfile --system --deploy 
COPY --chown=worker:worker server.py .
CMD ["python3", "./server.py"]