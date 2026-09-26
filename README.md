# 🚀 QueueLess — Smart Crowd & Queue Management System

QueueLess is an IoT-enabled, AI-powered crowd prediction and real-time queue management platform built for high-traffic public offices (such as the District Administration Office in Nepal). It replaces expensive touchscreen kiosks with low-cost thermal printer hardware and provides live queue tracking, dynamic delay handling, and Gemini AI-driven visit advice.

---

## ✨ Key Features

- **Live Token Tracking:** Real-time queue position updates, estimated wait times, and active counter monitoring.
- **Gemini AI Strategy Assistant:** Generates personalized visit recommendations and actionable document checklists using Google Gemini.
- **Low-Cost IoT Thermal Printer Integration:** Integrates with an ESP32 microcontroller and thermal printer setup to issue physical paper tickets linked directly to the digital backend.
- **Presence & Delay Workflow:** Dynamic token repositioning that allows users to defer their queue position without losing their turn completely.
- **Interactive Audio & Browser Alarms:** Web Audio API alarms notify citizens when their token is about to be called.

---

## 🏗️ System Architecture

The following diagram illustrates how physical IoT hardware, citizen mobile devices, the Express API gateway, and external AI services interact across the **QueueLess** ecosystem:

```text
  ┌─────────────────────────┐               ┌─────────────────────────┐
  │   Citizen Mobile App    │               │  IoT Thermal Printer    │
  │    (React + Clerk)      │               │  (ESP32 / Microchip)    │
  └────────────┬────────────┘               └────────────┬────────────┘
               │                                         │
               │ HTTP / REST                             │ HTTP POST (/api/tokens/issue)
               ▼                                         ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │                   Express.js Backend API Server                  │
  │                                                                  │
  │  ├── Queue Controller       ├── Worker / Counter Manager        │
  │  ├── Token Issue Handler    └── AI Visit Strategy Handler        │
  └────────────┬─────────────────────────────┬───────────────────────┘
               │                             │
        (Read / Write)                       │ API Request
               │                             │
               ▼                             ▼
  ┌─────────────────────────┐   ┌─────────────────────────┐
  │     MongoDB Database    │   │    Google Gemini API    │
  │   (Services & Tokens)   │   │   (gemini-2.5-flash)    │
  └─────────────────────────┘   └─────────────────────────┘

  Architecture Overview
Hardware Ingestion Layer (IoT): A citizen presses a physical button on the thermal printing station at the office entrance. The embedded ESP32 microcontroller issues an asynchronous HTTP POST /api/tokens/issue request to the backend.

Core API Gateway & Database (MERN Stack): Express processes the request, atomically increments the queue counter inside MongoDB, and returns the newly assigned token ID (e.g., A-101) along with live queue metrics to the printer.

AI Intelligence Engine (Gemini API): When a citizen requests an optimal visit strategy or document preparation plan, the server constructs a structured prompt using live queue metrics and queries gemini-2.5-flash via @google/genai.

Real-Time Client Dashboard (React): Citizens view real-time token tracking, crowd status forecasts, dynamic delay options, and AI visit recommendations seamlessly across desktop and mobile browsers.

🛠️ Tech Stack
Frontend: React.js, Tailwind CSS, Lucide React, Axios

Backend: Node.js, Express.js

Database: MongoDB (Mongoose)

AI Integration: @google/genai (Gemini API)

Authentication: Clerk

Hardware Integration: ESP32 / Web Serial ESC/POS API   (**in real word for now we are using simulating system for the example or demo**)






PRESENTATION LINK OR DEMO





