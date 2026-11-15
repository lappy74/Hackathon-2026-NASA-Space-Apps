// Farm - Main Heltec WiFi LoRa 32 V4
// USB serial: SEQ=... updates cache, PUSH:<weather> caches AND sends,
// PUSH sends the already-cached reading. PRG requests still work.
#include "LoRaWan_APP.h"
#include "Arduino.h"
#include "HT_SSD1306Wire.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

#define RF_FREQUENCY       915000000
#define TX_POWER          14
#define LORA_BW            0
#define LORA_SF            9
#define LORA_CR            1
#define LORA_PREAMBLE      8

// Same thing with the FarmLoRa sketch
// The rf center frequencies must match at 915MHz
// TX power at 14dBm (25mW of power) with max of 24
// Bandwidth must match also at 125kHz
// CR is coding rate

#define REPLY_DELAY_MS     350UL
#define TX_TIMEOUT_MS      4000UL
#define PUSH_ACK_TIMEOUT   8000UL

static RadioEvents_t events;
SSD1306Wire mainOLED(0x3c, 500000, SDA_OLED, SCL_OLED,
                    GEOMETRY_128_64, RST_OLED);

char cachedData[120] = "";
bool hasData = false;

// PUSH:<weather> can be longer than a normal cache packet.
char serialBuffer[160];
size_t serialLength = 0;

char receivedPacket[160];
bool received = false;
char replyPacket[120];
char pushFrame[160];

bool txDone = false;
bool txFailed = false;
unsigned long pushId = 0;
bool pendingFarmerRequest = false;

enum MainState {
  LISTENING,
  REPLY_DELAY,
  SENDING_REPLY,
  SENDING_PUSH,
  WAITING_PUSH_ACK
};
MainState state = LISTENING;
unsigned long stateStart = 0;

void onTxDone() { txDone = true; }
void onTxTimeout() { txFailed = true; }

void onRxDone(uint8_t *payload, uint16_t size, int16_t rssi, int8_t snr) {
  (void)rssi;
  (void)snr;
  if (size >= sizeof(receivedPacket)) {
    Serial.println("LORA_RX_TOO_LONG");
    return;
  }
  memcpy(receivedPacket, payload, size);
  receivedPacket[size] = '\0';
  received = true;
}
void onRxTimeout() {
  if (state == LISTENING || state == WAITING_PUSH_ACK) Radio.Rx(0);
}
void onRxError() {
  if (state == LISTENING || state == WAITING_PUSH_ACK) Radio.Rx(0);
}

bool validWeatherPacket(const char *packet) {
  unsigned long seq = 0;
  char date[9] = {0};
  char soil[3] = {0};
  int gdd10 = 0, temp10 = 0, rain = -1, consumed = 0;
  int count = sscanf(packet,
    "SEQ=%lu,D=%8[0-9],G10=%d,T10=%d,R=%d,SM=%2s%n",
    &seq, date, &gdd10, &temp10, &rain, soil, &consumed);
  return count == 6 && consumed == (int)strlen(packet) &&
         strlen(date) == 8 && strcmp(soil, "NA") == 0 &&
         gdd10 >= 0 && gdd10 <= 1000 &&
         temp10 >= -500 && temp10 <= 700 &&
         (rain == 0 || rain == 1);
}

void drawMainOLED(const String &statusText) {
  mainOLED.clear();
  mainOLED.setTextAlignment(TEXT_ALIGN_LEFT);
  mainOLED.setFont(ArialMT_Plain_10);
  mainOLED.drawString(0, 0, "Farm Main Station");
  mainOLED.drawString(0, 10, "Radio: " + statusText);

  if (!hasData) {
    mainOLED.drawString(0, 25, "No cached data yet");
    mainOLED.drawString(0, 40, "Waiting for Python");
  } else {
    unsigned long seq = 0;
    char date[9] = {0}, soil[3] = {0};
    int gdd10 = 0, temp10 = 0, rain = 0;
    int count = sscanf(cachedData,
      "SEQ=%lu,D=%8[0-9],G10=%d,T10=%d,R=%d,SM=%2s",
      &seq, date, &gdd10, &temp10, &rain, soil);
    if (count == 6) {
      String dateText = String(date).substring(0, 4) + "-" +
                        String(date).substring(4, 6) + "-" +
                        String(date).substring(6, 8);
      mainOLED.drawString(0, 20, "Date: " + dateText);
      mainOLED.drawString(0, 30, "Temp: " + String(temp10 / 10.0f, 1) + " C");
      mainOLED.drawString(0, 40, "GDD: " + String(gdd10 / 10.0f, 1));
      mainOLED.drawString(0, 50, String("Rain: ") +
        (rain ? "YES" : "NO") + " Soil:N/A");
    }
  }
  mainOLED.display();
}

void updateCache(const char *packet) {
  strncpy(cachedData, packet, sizeof(cachedData) - 1);
  cachedData[sizeof(cachedData) - 1] = '\0';
  hasData = true;
  Serial.print("CACHE_UPDATED=");
  Serial.println(cachedData);
  drawMainOLED("Cache updated");
}

void beginFarmerReply() {
  const char *reply = hasData ? cachedData : "NO_DATA";
  strncpy(replyPacket, reply, sizeof(replyPacket) - 1);
  replyPacket[sizeof(replyPacket) - 1] = '\0';
  pendingFarmerRequest = false;
  Radio.Sleep();
  state = REPLY_DELAY;
  stateStart = millis();
  drawMainOLED("Request received");
}

void backToListen() {
  Radio.Sleep();
  state = LISTENING;
  Radio.Rx(0);
  if (pendingFarmerRequest) beginFarmerReply();
}

void beginPush() {
  if (state != LISTENING) {
    Serial.println("PUSH_ERROR=BUSY");
    return;
  }
  if (!hasData) {
    Serial.println("PUSH_ERROR=NO_DATA");
    return;
  }

  ++pushId;
  int len = snprintf(pushFrame, sizeof(pushFrame),
                     "PUSH=%lu|%s", pushId, cachedData);
  if (len < 0 || len >= (int)sizeof(pushFrame)) {
    Serial.println("PUSH_ERROR=PACKET_TOO_LONG");
    return;
  }

  txDone = false;
  txFailed = false;
  received = false;
  Radio.Sleep();
  state = SENDING_PUSH;
  stateStart = millis();

  Serial.print("PUSH_ACCEPTED=");
  Serial.println(pushId);
  Radio.Send((uint8_t *)pushFrame, strlen(pushFrame));
  drawMainOLED("Pushing to farm");
}

// USB commands come only from the Python bridge.
void processSerial(const char *line) {
  if (strcmp(line, "SHOW") == 0) {
    Serial.println(hasData ? cachedData : "NO_DATA");
    return;
  }

  // Dashboard manual send: one USB command caches and sends wirelessly.
  if (strncmp(line, "PUSH:", 5) == 0) {
    if (state != LISTENING) {
      Serial.println("PUSH_ERROR=BUSY");
    } else if (!validWeatherPacket(line + 5)) {
      Serial.println("PUSH_ERROR=BAD_PACKET");
    } else {
      updateCache(line + 5);
      beginPush();
    }
    return;
  }

  // Useful for manually testing the current cache without re-fetching data.
  if (strcmp(line, "PUSH") == 0) {
    beginPush();
    return;
  }

  // Existing automatic Supabase cache update remains unchanged.
  if (strncmp(line, "SEQ=", 4) == 0) {
    if (!validWeatherPacket(line)) {
      Serial.println("CACHE_ERROR=BAD_PACKET");
    } else {
      updateCache(line);
    }
  }
}

void setup() {
  Serial.begin(115200);
  Mcu.begin(HELTEC_BOARD, SLOW_CLK_TPYE);
  pinMode(Vext, OUTPUT);
  digitalWrite(Vext, LOW);
  delay(100);
  mainOLED.init();
  mainOLED.clear();
  mainOLED.display();
  drawMainOLED("Starting...");

  events.TxDone = onTxDone;
  events.TxTimeout = onTxTimeout;
  events.RxDone = onRxDone;
  events.RxTimeout = onRxTimeout;
  events.RxError = onRxError;
  Radio.Init(&events);
  Radio.SetChannel(RF_FREQUENCY);
  Radio.SetTxConfig(MODEM_LORA, TX_POWER, 0, LORA_BW, LORA_SF,
                    LORA_CR, LORA_PREAMBLE, false, true,
                    0, 0, false, 3000);
  Radio.SetRxConfig(MODEM_LORA, LORA_BW, LORA_SF, LORA_CR,
                    0, LORA_PREAMBLE, 0, false, 0,
                    true, 0, 0, false, true);
  Radio.SetPublicNetwork(false);
  Radio.Rx(0);
  Serial.println("FARM_MAIN_READY");
  drawMainOLED("Listening");
}

void loop() {
  Radio.IrqProcess();

  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialLength > 0) {
        serialBuffer[serialLength] = '\0';
        processSerial(serialBuffer);
        serialLength = 0;
      }
    } else if (serialLength < sizeof(serialBuffer) - 1) {
      serialBuffer[serialLength++] = c;
    } else {
      serialLength = 0;
      Serial.println("SERIAL_ERROR=TOO_LONG");
    }
  }

  // A radio response to a dashboard push, or a regular PRG request.
  if (received) {
    received = false;
    if (state == WAITING_PUSH_ACK) {
      char *endPtr = NULL;
      if (strncmp(receivedPacket, "ACK=", 4) == 0) {
        unsigned long ackId = strtoul(receivedPacket + 4, &endPtr, 10);
        if (endPtr != receivedPacket + 4 && *endPtr == '\0' &&
            ackId == pushId) {
          Serial.print("PUSH_ACK_RECEIVED=");
          Serial.println(pushId);
          drawMainOLED("Farm delivered!");
          backToListen();
        } else {
          Serial.println("PUSH_ACK_MISMATCH");
          Radio.Rx(0);
        }
      } else if (strcmp(receivedPacket, "REQ=LATEST") == 0) {
        // Don't forget a PRG request that arrives during an ACK wait.
        pendingFarmerRequest = true;
        Serial.println("LORA_RECEIVED=REQ=LATEST");
        Radio.Rx(0);
      } else {
        Radio.Rx(0);
      }
    } else if (state == LISTENING) {
      Serial.print("LORA_RECEIVED=");
      Serial.println(receivedPacket);
      if (strcmp(receivedPacket, "REQ=LATEST") == 0) {
        beginFarmerReply();
      } else {
        Radio.Rx(0);
      }
    }
  }

  if (state == REPLY_DELAY && millis() - stateStart >= REPLY_DELAY_MS) {
    txDone = false;
    txFailed = false;
    state = SENDING_REPLY;
    stateStart = millis();
    Radio.Send((uint8_t *)replyPacket, strlen(replyPacket));
    Serial.print("REPLY_STARTED=");
    Serial.println(replyPacket);
    drawMainOLED("Sending reply");
  }

  if (state == SENDING_REPLY &&
      (txDone || txFailed || millis() - stateStart > TX_TIMEOUT_MS)) {
    bool sent = txDone;
    Serial.println(sent ? "REPLY_TX_DONE" : "REPLY_TX_RECOVERY");
    txDone = false;
    txFailed = false;
    drawMainOLED(sent ? "Reply sent" : "TX recovery");
    backToListen();
  }

  if (state == SENDING_PUSH &&
      (txDone || txFailed || millis() - stateStart > TX_TIMEOUT_MS)) {
    bool sent = txDone;
    txDone = false;
    txFailed = false;
    if (sent) {
      Serial.print("PUSH_TX_DONE=");
      Serial.println(pushId);
      state = WAITING_PUSH_ACK;
      stateStart = millis();
      Radio.Rx(0);
      drawMainOLED("Awaiting farm ACK");
    } else {
      Serial.print("PUSH_TX_FAILED=");
      Serial.println(pushId);
      drawMainOLED("Push TX failed");
      backToListen();
    }
  }

  if (state == WAITING_PUSH_ACK &&
      millis() - stateStart >= PUSH_ACK_TIMEOUT) {
    Serial.print("PUSH_ACK_TIMEOUT=");
    Serial.println(pushId);
    drawMainOLED("ACK not received");
    backToListen();
  }

  delay(1);
}
