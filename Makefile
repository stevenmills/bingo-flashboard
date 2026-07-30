.PHONY: help frontend-install frontend-build fw-build fw-upload fs-upload deploy monitor qa

QA_BASE ?= http://bingo.local
QA_PIN ?= 1975

PIO_ENV ?= esp32s3
PIO_PORT ?=
MONITOR_SPEED ?= 115200

ifdef PIO_PORT
UPLOAD_PORT_ARG := --upload-port $(PIO_PORT)
MONITOR_PORT_ARG := --monitor-port $(PIO_PORT)
else
UPLOAD_PORT_ARG :=
MONITOR_PORT_ARG :=
endif

help:
	@echo "Bingo Flashboard helper targets"
	@echo ""
	@echo "make frontend-install     Install frontend dependencies"
	@echo "make frontend-build       Build frontend to data/"
	@echo "make fw-build             Build firmware ($(PIO_ENV))"
	@echo "make fw-upload            Upload firmware ($(PIO_ENV))"
	@echo "make fs-upload            Upload SPIFFS data ($(PIO_ENV))"
	@echo "make deploy               Build frontend + upload firmware + upload SPIFFS"
	@echo "make qa                   Run board API smoke tests (QA_BASE, QA_PIN)"
	@echo "make monitor              Open serial monitor"
	@echo ""
	@echo "Optional variables:"
	@echo "  PIO_ENV=esp32s3         PlatformIO environment"
	@echo "  PIO_PORT=/dev/cu.usb*   Force serial port for upload/monitor (often usbmodem on S3)"
	@echo "  MONITOR_SPEED=115200    Serial monitor baud"

frontend-install:
	npm --prefix frontend install

frontend-build:
	npm --prefix frontend run build

fw-build:
	pio run -e $(PIO_ENV)

fw-upload:
	pio run -e $(PIO_ENV) -t upload $(UPLOAD_PORT_ARG)

fs-upload:
	node scripts/prune-spiffs-data.mjs
	pio run -e $(PIO_ENV) -t uploadfs $(UPLOAD_PORT_ARG)

deploy: frontend-build fw-upload fs-upload

qa:
	python3 scripts/qa-board.py --base $(QA_BASE) --pin $(QA_PIN)

monitor:
	pio device monitor -b $(MONITOR_SPEED) $(MONITOR_PORT_ARG)
