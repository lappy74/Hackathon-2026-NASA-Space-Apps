// Farm - Farmer Heltec WiFi LoRa 32 V4 + external LCD2004
// Receives PUSH=<id>|SEQ=... automatically, updates LCD and returns ACK=<id>.
// Existing PRG button and USB GET continue to request REQ=LATEST.
#include "LoRaWan_APP.h"
#include "Arduino.h"
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

// LiquidCrystal is for the LCD2004 Being used. 
// The sketch utilizes a premade receive sketch from the Heltec Library

#define RF_FREQUENCY       915000000
#define TX_POWER          14
#define LORA_BW            0
#define LORA_SF            9
#define LORA_CR            1
#define LORA_PREAMBLE      8

#define REQUEST_BUTTON     0
#define DEBOUNCE_MS        50UL
#define RESPONSE_TIMEOUT   8000UL
#define TX_TIMEOUT         4000UL
#define ACK_DELAY_MS       300UL

// RF centered at 915MHz
// Bandwidth is at 125kHz
// Scatter at 9 
// The settings as of now are focused on a slower airtime (longer to received)
// 

static RadioEvents_t events;
static LiquidCrystal_I2C lcd(0x27, 20, 4);

char receivedPacket[160];
bool received = false;
bool txDone = false;
bool txFailed = false;
char ackPacket[32];
unsigned long ackId = 0;

enum RequestState {
  IDLE,
  SENDING_REQUEST,
  WAITING_RESPONSE,
  ACK_DELAY,
  SENDING_ACK
};
RequestState state = IDLE;
unsigned long stateStart = 0;

bool lastButtonReading = HIGH;
bool stableButtonState = HIGH;
unsigned long lastButtonChange = 0;
char serialBuffer[20];
size_t serialLength = 0;

void showLine(uint8_t row, const String &message) {
  lcd.setCursor(0, row);
  lcd.print("                    ");
  lcd.setCursor(0, row);
  lcd.print(message.substring(0, 20));
}

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
  if (state == IDLE || state == WAITING_RESPONSE) Radio.Rx(0);
}
void onRxError() {
  if (state == IDLE || state == WAITING_RESPONSE) Radio.Rx(0);
}

void requestData() {
  if (state != IDLE) {
    Serial.println("REQUEST_BUSY");
    return;
  }
  Serial.println("REQUESTING_LATEST");
  showLine(0, "Farm - Requesting");
  showLine(1, "Contacting main...");
  showLine(2, "");
  showLine(3, "");

  txDone = false;
  txFailed = false;
  received = false;
  state = SENDING_REQUEST;
  stateStart = millis();
  Radio.Sleep();
  const char *request = "REQ=LATEST";
  Radio.Send((uint8_t *)request, strlen(request));
}

// Return true only when the entire packet is valid and was displayed.
bool displayWeather(const char *packet) {
  unsigned long seq = 0;
  char date[9] = {0}, soil[3] = {0};
  int gdd10 = 0, temp10 = 0, rain = -1, consumed = 0;
  int count = sscanf(packet,
    "SEQ=%lu,D=%8[0-9],G10=%d,T10=%d,R=%d,SM=%2s%n",
    &seq, date, &gdd10, &temp10, &rain, soil, &consumed);
  if (count != 6 || consumed != (int)strlen(packet) ||
      strlen(date) != 8 || strcmp(soil, "NA") != 0 ||
      gdd10 < 0 || gdd10 > 1000 ||
      temp10 < -500 || temp10 > 700 ||
      (rain != 0 && rain != 1)) {
    Serial.println("INVALID_WEATHER_PACKET");
    showLine(0, "Farm - Invalid Data");
    return false;
  }

  String dateText = String(date).substring(0, 4) + "-" +
                    String(date).substring(4, 6) + "-" +
                    String(date).substring(6, 8);
  showLine(0, "Farm " + dateText);
  showLine(1, "Temp: " + String(temp10 / 10.0f, 1) + " C");
  showLine(2, "GDD:  " + String(gdd10 / 10.0f, 1));
  showLine(3, String("Rain: ") + (rain ? "YES" : "NO") + " Soil:N/A");
  Serial.print("DATA_RECEIVED=");
  Serial.println(packet);
  return true;
}

void handleIncoming(const char *packet) {
  // PUSH has a unique ID, so old ACKs cannot confirm a new send.
  if (strncmp(packet, "PUSH=", 5) == 0) {
    char *endPtr = NULL;
    unsigned long incomingId = strtoul(packet + 5, &endPtr, 10);
    if (endPtr == packet + 5 || *endPtr != '|' || incomingId == 0) {
      Serial.println("PUSH_INVALID_HEADER");
      Radio.Rx(0);
      return;
    }
    if (!displayWeather(endPtr + 1)) {
      Radio.Rx(0);
      return;
    }

    Serial.print("PUSH_RECEIVED=");
    Serial.println(incomingId);
    ackId = incomingId;
    snprintf(ackPacket, sizeof(ackPacket), "ACK=%lu", ackId);
    received = false;
    state = ACK_DELAY;
    stateStart = millis();
    return;
  }

  // Old PRG request/reply behavior remains intact.
  if (strcmp(packet, "NO_DATA") == 0 && state == WAITING_RESPONSE) {
    showLine(0, "Farm - No Data");
    showLine(1, "Main has no update");
    state = IDLE;
    Radio.Rx(0);
    return;
  }

  if (strncmp(packet, "SEQ=", 4) == 0 &&
      (state == WAITING_RESPONSE || state == IDLE)) {
    displayWeather(packet);
    state = IDLE;
    Radio.Rx(0);
    return;
  }

  // Unknown radio message; stay ready for the next one.
  if (state == IDLE || state == WAITING_RESPONSE) Radio.Rx(0);
}

void setup() {
  Serial.begin(115200);
  Mcu.begin(HELTEC_BOARD, SLOW_CLK_TPYE);
  pinMode(REQUEST_BUTTON, INPUT_PULLUP);
  Wire.begin(3, 4);
  Wire.setClock(100000);
  lcd.init();
  lcd.backlight();
  showLine(0, "Farm LoRa Station");
  showLine(1, "PRG or Dashboard");
  showLine(2, "");
  showLine(3, "");

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
  Serial.println("FARM_RECEIVER_READY");
}

void loop() {
  Radio.IrqProcess();

  bool reading = digitalRead(REQUEST_BUTTON);
  if (reading != lastButtonReading) lastButtonChange = millis();
  if (millis() - lastButtonChange >= DEBOUNCE_MS &&
      reading != stableButtonState) {
    stableButtonState = reading;
    if (stableButtonState == LOW) requestData();
  }
  lastButtonReading = reading;

  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialLength > 0) {
        serialBuffer[serialLength] = '\0';
        if (strcmp(serialBuffer, "GET") == 0) requestData();
        serialLength = 0;
      }
    } else if (serialLength < sizeof(serialBuffer) - 1) {
      serialBuffer[serialLength++] = c;
    } else {
      serialLength = 0;
    }
  }

  if (received) {
    received = false;
    Serial.print("LORA_RX=");
    Serial.println(receivedPacket);
    handleIncoming(receivedPacket);
  }

  if (state == SENDING_REQUEST) {
    if (txDone) {
      Serial.println("REQUEST_TX_DONE");
      txDone = false;
      txFailed = false;
      state = WAITING_RESPONSE;
      stateStart = millis();
      Radio.Rx(0);
    } else if (txFailed || millis() - stateStart > TX_TIMEOUT) {
      Serial.println("REQUEST_TX_FAILED");
      txDone = false;
      txFailed = false;
      state = IDLE;
      Radio.Sleep();
      Radio.Rx(0);
      showLine(0, "Farm - TX Failed");
      showLine(1, "Press PRG to retry");
    }
  }

  if (state == WAITING_RESPONSE &&
      millis() - stateStart > RESPONSE_TIMEOUT) {
    Serial.println("RESPONSE_TIMEOUT");
    showLine(0, "Farm - No Response");
    showLine(1, "Press PRG to retry");
    state = IDLE;
    Radio.Sleep();
    Radio.Rx(0);
  }

  // Let the main station finish switching from TX back to RX.
  if (state == ACK_DELAY && millis() - stateStart >= ACK_DELAY_MS) {
    txDone = false;
    txFailed = false;
    Radio.Sleep();
    state = SENDING_ACK;
    stateStart = millis();
    Radio.Send((uint8_t *)ackPacket, strlen(ackPacket));
  }

  if (state == SENDING_ACK &&
      (txDone || txFailed || millis() - stateStart > TX_TIMEOUT)) {
    bool sent = txDone;
    if (sent) {
      Serial.print("PUSH_ACK_TX_DONE=");
      Serial.println(ackId);
    } else {
      Serial.print("PUSH_ACK_TX_FAILED=");
      Serial.println(ackId);
    }
    txDone = false;
    txFailed = false;
    state = IDLE;
    Radio.Sleep();
    Radio.Rx(0);
  }

  delay(1);
}
