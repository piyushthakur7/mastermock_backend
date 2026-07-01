# MasterMock — Frontend API Integration Guide

> **Date:** 20 June 2026  
> **Backend Version:** v2.0  
> **Base URL:** `/api/v1`  
> **Auth:** All endpoints (except `/auth/*` and `/resources/serve`) require `Authorization: Bearer <token>` header.

---

## Table of Contents

1. [What Changed (Summary)](#1-what-changed-summary)
2. [Mock Test APIs](#2-mock-test-apis)
3. [Start & Take a Test (Test Attempt APIs)](#3-start--take-a-test-test-attempt-apis)
4. [Payment & Razorpay Integration](#4-payment--razorpay-integration)
5. [Resources / PDFs](#5-resources--pdfs)
6. [Leaderboard](#6-leaderboard)
7. [Dashboard](#7-dashboard)
8. [Complete User Flows](#8-complete-user-flows)
9. [Data Models Reference](#9-data-models-reference)
10. [Error Codes Reference](#10-error-codes-reference)

---

## 1. What Changed (Summary)

| Area | What's New |
|------|-----------|
| **Mock Tests** | Each test now has `access_type` (`"free"` / `"paid"`) and `price`. Tests are **independent of courses**. |
| **Start Test** | New `check-access` endpoint + purchase check before starting paid tests. |
| **Payments** | Fixed Razorpay flow. Backend auto-fetches price. New `my-purchases` & `my-history` endpoints. |
| **PDFs/Resources** | Decoupled from courses. All PDFs are **free** for logged-in users. New `GET /resources` endpoint. |
| **Leaderboard** | Pagination support, best-score-per-user ranking, new `my-rank` endpoint. |
| **Dashboard** | Admin dashboard now includes `totalFreeTests` and `totalPaidTests`. |
| **Authentication** | Added dedicated `/admin-login` endpoint to strictly enforce `ADMIN` roles for the admin panel. |

### 1.1 Admin Authentication API

```
POST /api/v1/auth/admin-login
```

**Description:** Use this endpoint specifically for your frontend Admin Login page (`/admin/login`). It works exactly like the regular student login but will throw a `403 Access Denied` error if the user is not an `ADMIN`.

**Request Body:**
```json
{
  "email": "admin@example.com",
  "password": "your_password"
}
```

**Success Response (200):** Same as normal login (returns user object, sets cookies, returns tokens).

**Error Responses:**
| Status | When |
|--------|------|
| `401` | Invalid email or password |
| `403` | User is a student, not an ADMIN |
| `403` | Account is temporarily locked due to 5 failed attempts (15 min lock) |

### ⚠️ Breaking Changes

| Endpoint | Old Field | New Field |
|----------|-----------|-----------|
| `POST /payments/create-order` | `amount` (from frontend) | **Removed** — backend auto-fetches price |
| `POST /payments/verify` | Response used `payment_status` | Now uses `status` |
| Mock Test object | — | New fields: `access_type`, `price` |

---

## 2. Mock Test APIs

### 2.1 List All Mock Tests

```
GET /api/v1/mock-tests
```

**Auth:** Required (Student/Admin)

**Response:**
```json
{
  "statusCode": 200,
  "data": [
    {
      "_id": "6650abc123...",
      "title": "SSC CGL Prelims 2026",
      "description": "Full mock test for SSC CGL",
      "access_type": "free",
      "price": 0,
      "difficulty": "medium",
      "total_questions": 100,
      "total_marks": 200,
      "duration_minutes": 60,
      "passing_marks": 80,
      "negative_marking": true,
      "negative_marks_per_wrong": 0.5,
      "category": "6650abc456...",
      "is_active": true,
      "createdAt": "2026-06-20T..."
    },
    {
      "_id": "6650abc789...",
      "title": "SSC CGL Full Mock - Premium",
      "access_type": "paid",
      "price": 199,
      "difficulty": "hard",
      "..."
    }
  ],
  "message": "Mock tests fetched successfully"
}
```

**Frontend Usage:**
- Show **"FREE"** badge if `access_type === "free"`
- Show **"₹199"** / **"PAID"** badge if `access_type === "paid"`
- Show **"Start Test"** button for free tests
- Show **"Buy Now — ₹{price}"** button for paid tests (unless already purchased)

---

### 2.2 Get Single Mock Test

```
GET /api/v1/mock-tests/:id
```

**Auth:** Required  
**Response:** Same shape as a single item from the list above, with full `questions` array (answers hidden for students).

---

### 2.3 Check Access (Can User Start This Test?)

```
GET /api/v1/mock-tests/:id/check-access
```

**Auth:** Required (Student)

**Response:**
```json
{
  "statusCode": 200,
  "data": {
    "has_access": true,
    "access_type": "free",
    "price": 0,
    "reason": "Free test — no purchase required"
  },
  "message": "Access check completed"
}
```

**If paid and NOT purchased:**
```json
{
  "statusCode": 200,
  "data": {
    "has_access": false,
    "access_type": "paid",
    "price": 199,
    "reason": "Paid test — purchase required"
  }
}
```

**Frontend Logic:**
```javascript
const res = await api.get(`/mock-tests/${testId}/check-access`);
if (res.data.has_access) {
  // Show "Start Test" button
} else {
  // Show "Buy Now — ₹{res.data.price}" button → trigger Razorpay
}
```

---

### 2.4 Get My Purchased Tests

```
GET /api/v1/mock-tests/my/purchased
```

**Auth:** Required (Student)

**Response:** Array of mock test objects that the user has purchased.

---

## 3. Start & Take a Test (Test Attempt APIs)

### 3.1 Start a Test

```
POST /api/v1/attempts/start
```

**Auth:** Required (Student)

**Request Body:**
```json
{
  "mock_test_id": "6650abc123..."
}
```

**Success Response (201):**
```json
{
  "statusCode": 201,
  "data": {
    "_id": "attempt_id_here",
    "user": "user_id",
    "mock_test": "6650abc123...",
    "started_at": "2026-06-20T10:00:00Z",
    "status": "IN_PROGRESS",
    "answers": []
  },
  "message": "Test started successfully"
}
```

**Error Responses:**
| Status | When |
|--------|------|
| `403` | Paid test not purchased: `"This is a paid test. Please purchase it first."` |
| `400` | Max 3 attempts reached: `"Maximum attempt limit reached for this test"` |
| `404` | Test not found or inactive |

**Frontend:** Save the returned `attempt _id` — you'll need it for saving answers and submitting.

---

### 3.2 Save an Answer

```
PUT /api/v1/attempts/:attemptId/answer
```

**Auth:** Required (Student)

**Request Body:**
```json
{
  "question_id": "q_id_here",
  "selected_option_id": "option_id_here",
  "is_marked_for_review": false
}
```

**Response (200):** Updated answers array.

> 💡 **Tip:** Call this on every answer selection to auto-save progress.

---

### 3.3 Submit Test

```
POST /api/v1/attempts/:attemptId/submit
```

**Auth:** Required (Student)  
**Request Body:** None  
**Response (200):** Attempt object with `status: "COMPLETED"`

---

### 3.4 Evaluate Test (Get Score)

```
POST /api/v1/attempts/:attemptId/evaluate
```

**Auth:** Required (Student)  
**Response (200):**
```json
{
  "statusCode": 200,
  "data": {
    "_id": "attempt_id",
    "status": "COMPLETED",
    "score": 156,
    "percentage": 78,
    "answers": [
      {
        "question_id": "...",
        "question_text": "What is...?",
        "selected_option_text": "Option A",
        "is_correct": true
      }
    ]
  },
  "message": "Test evaluated successfully"
}
```

---

### 3.5 Get Attempt Details

```
GET /api/v1/attempts/:attemptId
```

**Auth:** Required (Student)  
**Response:** Full attempt object with answers.

---

## 4. Payment & Razorpay Integration

### 4.1 Complete Payment Flow

```
┌─────────────┐      ┌──────────────┐      ┌──────────────┐
│   Frontend   │      │   Backend    │      │   Razorpay   │
└──────┬──────┘      └──────┬───────┘      └──────┬───────┘
       │                     │                     │
       │  POST /create-order │                     │
       │  {item_id,item_type}│                     │
       │────────────────────>│                     │
       │                     │   Create Order      │
       │                     │────────────────────>│
       │                     │   order_id, amount  │
       │                     │<────────────────────│
       │  {order_id, amount, │                     │
       │   currency, key_id} │                     │
       │<────────────────────│                     │
       │                     │                     │
       │  Open Razorpay      │                     │
       │  Checkout Modal     │                     │
       │─────────────────────────────────────────>│
       │                     │                     │
       │  Payment Success    │                     │
       │  {razorpay_order_id,│                     │
       │   razorpay_payment_id,                    │
       │   razorpay_signature}                     │
       │<─────────────────────────────────────────│
       │                     │                     │
       │  POST /verify       │                     │
       │  {razorpay_order_id,│                     │
       │   razorpay_payment_id,                    │
       │   razorpay_signature}                     │
       │────────────────────>│                     │
       │                     │  Verify signature   │
       │                     │  Create Purchase    │
       │  Payment verified   │                     │
       │<────────────────────│                     │
       │                     │                     │
       │  User can now start │                     │
       │  the paid test      │                     │
```

---

### 4.2 Create Order

```
POST /api/v1/payments/create-order
```

**Auth:** Required (Student)

**Request Body:**
```json
{
  "item_id": "6650abc789...",
  "item_type": "MockTest"
}
```

> ⚠️ **No `amount` needed** — backend fetches the price automatically from the MockTest/Course.  
> `item_type` must be either `"MockTest"` or `"Course"`.

**Success Response (200):**
```json
{
  "statusCode": 200,
  "data": {
    "order_id": "order_PqRsT12345",
    "amount": 199,
    "currency": "INR",
    "key_id": "rzp_test_xxxxxx"
  },
  "message": "Order created"
}
```

**Error Responses:**
| Status | When |
|--------|------|
| `400` | Item is free (no payment needed) |
| `400` | Already purchased |
| `404` | Item not found |

---

### 4.3 Open Razorpay Checkout (Frontend Code)

```javascript
const createOrder = async (itemId, itemType) => {
  const { data } = await api.post('/payments/create-order', {
    item_id: itemId,
    item_type: itemType,  // "MockTest" or "Course"
  });

  const options = {
    key: data.data.key_id,
    amount: data.data.amount * 100,  // Razorpay expects paise
    currency: data.data.currency,
    name: 'MasterMock',
    description: 'Mock Test Purchase',
    order_id: data.data.order_id,
    handler: async (response) => {
      // Verify payment on backend
      await api.post('/payments/verify', {
        razorpay_order_id: response.razorpay_order_id,
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_signature: response.razorpay_signature,
      });
      
      // Payment successful — redirect to test or show success
      alert('Payment successful! You can now start the test.');
    },
    prefill: {
      name: user.full_name,
      email: user.email,
    },
    theme: {
      color: '#6366f1',
    },
  };

  const rzp = new window.Razorpay(options);
  rzp.open();
};
```

> 💡 **Don't forget** to include the Razorpay checkout script in your HTML:
> ```html
> <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
> ```

---

### 4.4 Verify Payment

```
POST /api/v1/payments/verify
```

**Auth:** Required (Student)

**Request Body:**
```json
{
  "razorpay_order_id": "order_PqRsT12345",
  "razorpay_payment_id": "pay_AbCdE67890",
  "razorpay_signature": "hex_signature_string"
}
```

**Success Response (200):** Payment object with `status: "SUCCESS"`

---

### 4.5 Get My Purchases

```
GET /api/v1/payments/my-purchases
```

**Auth:** Required (Student)

**Response:**
```json
{
  "statusCode": 200,
  "data": [
    {
      "_id": "purchase_id",
      "item_id": {
        "_id": "6650abc789...",
        "title": "SSC CGL Full Mock - Premium",
        "access_type": "paid",
        "price": 199
      },
      "item_type": "MockTest",
      "amount": 199,
      "status": "ACTIVE",
      "purchase_date": "2026-06-20T...",
      "createdAt": "2026-06-20T..."
    }
  ],
  "message": "Purchases fetched successfully"
}
```

---

### 4.6 Get My Payment History

```
GET /api/v1/payments/my-history
```

**Auth:** Required  
**Response:** Array of all payment records (PENDING, SUCCESS, FAILED).

---

### 4.7 Webhook Fallback (Delayed Payments)

**Endpoint:** `POST /api/v1/payments/webhook` (Internal/Razorpay only)

**Overview:**
We have implemented a Razorpay Webhook on the backend to handle delayed UPI payment confirmations.

Sometimes the UPI network is slow. A user might pay, the money gets deducted, but the Razorpay checkout modal stays loading and the frontend `handler` callback never runs. In this scenario, `/payments/verify` is never called by the frontend, so the user doesn't get access immediately.

**How we solve it:**
- When Razorpay finally gets confirmation from the bank (even 5-10 minutes later), it sends a `payment.captured` webhook to the backend.
- The backend verifies the webhook and automatically marks the payment as `SUCCESS`, creating the `Purchase` record and auto-enrolling the student.

**Impact on Frontend:**
- **No code changes are required on the frontend.**
- Continue using the standard Razorpay checkout flow and your existing `handler`.
- **Customer Support:** If a user complains about "money deducted but test not unlocked", you can assure them that the backend webhook will automatically grant them access as soon as the bank confirms the payment to Razorpay. No manual intervention is needed.

---

## 5. Resources / PDFs

> **All PDFs are FREE for logged-in users. No purchase needed.**

### 5.1 Get All Resources

```
GET /api/v1/resources
GET /api/v1/resources?category=CATEGORY_ID
GET /api/v1/resources?resource_type=pdf
```

**Auth:** Required (Student)

**Response:**
```json
{
  "statusCode": 200,
  "data": [
    {
      "_id": "resource_id",
      "title": "SSC CGL Previous Year Paper 2025",
      "description": "Complete solved paper",
      "resource_type": "pdf",
      "category": { "_id": "...", "name": "SSC CGL" },
      "course": null,
      "is_active": true,
      "createdAt": "2026-06-20T..."
    }
  ],
  "message": "Resources fetched successfully"
}
```

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `category` | ObjectId | Filter by category |
| `resource_type` | String | Filter: `pdf`, `video`, `notes`, `assignment`, `solution` |

---

### 5.2 Download a Resource

```
GET /api/v1/resources/:id/download
```

**Auth:** Required (Student)

**Response:**
```json
{
  "statusCode": 200,
  "data": {
    "downloadUrl": "https://...signed-url..."
  },
  "message": "Signed URL generated successfully"
}
```

**Frontend:** Open the `downloadUrl` in a new tab or trigger download.

---

### 5.3 Get Resources by Course (Backward Compatible)

```
GET /api/v1/resources/course/:courseId
```

Still works for resources that are attached to a course.

---

## 6. Leaderboard

### 6.1 Get Leaderboard for a Test

```
GET /api/v1/leaderboard/:testId
GET /api/v1/leaderboard/:testId?limit=100&page=1
```

**Auth:** Required (Student)

**Query Parameters:**
| Param | Type | Default | Max | Description |
|-------|------|---------|-----|-------------|
| `limit` | Number | 100 | 500 | Entries per page |
| `page` | Number | 1 | — | Page number |

**Response:**
```json
{
  "statusCode": 200,
  "data": {
    "entries": [
      {
        "rank": 1,
        "user": {
          "_id": "user_id",
          "full_name": "Rahul Sharma",
          "email": "rahul@example.com",
          "profile_picture": null
        },
        "best_score": 185,
        "best_percentage": 92.5,
        "total_attempts": 3,
        "last_attempt_at": "2026-06-19T..."
      },
      {
        "rank": 2,
        "user": {
          "full_name": "Priya Patel",
          "..."
        },
        "best_score": 178,
        "best_percentage": 89,
        "total_attempts": 1,
        "last_attempt_at": "2026-06-18T..."
      }
    ],
    "total_participants": 150,
    "page": 1,
    "limit": 100,
    "total_pages": 2
  },
  "message": "Leaderboard fetched"
}
```

> 💡 **Ranking logic:** Each user appears **once** with their **best score**. Ties share the same rank.

---

### 6.2 Get My Rank

```
GET /api/v1/leaderboard/:testId/my-rank
```

**Auth:** Required (Student)

**Response:**
```json
{
  "statusCode": 200,
  "data": {
    "rank": 12,
    "best_score": 156,
    "best_percentage": 78,
    "total_attempts": 2,
    "total_participants": 150
  },
  "message": "Your rank fetched successfully"
}
```

**If user hasn't attempted:**
```json
{
  "data": {
    "rank": null,
    "message": "No completed attempts found"
  }
}
```

---

## 7. Dashboard

### 7.1 Student Dashboard

```
GET /api/v1/dashboard/student
```

No changes to this endpoint.

---

### 7.2 Admin Dashboard

```
GET /api/v1/dashboard/admin
```

**Updated Response (new fields marked with ✨):**
```json
{
  "statusCode": 200,
  "data": {
    "totalStudents": 1500,
    "totalCourses": 12,
    "totalTests": 45,
    "totalFreeTests": 30,    // ✨ NEW
    "totalPaidTests": 15,    // ✨ NEW
    "revenue": 125000
  },
  "message": "Admin dashboard fetched"
}
```

---

## 8. Complete User Flows

### Flow 1: Student Takes a FREE Mock Test

```
1. GET  /mock-tests                    → Show list, identify free tests
2. GET  /mock-tests/:id               → Show test details page
3. GET  /mock-tests/:id/check-access   → Confirm access (has_access: true)
4. POST /attempts/start                → { mock_test_id } → Get attempt_id
5. PUT  /attempts/:attemptId/answer    → Save each answer
6. POST /attempts/:attemptId/submit    → Submit when done
7. POST /attempts/:attemptId/evaluate  → Get score & results
8. GET  /leaderboard/:testId           → Show leaderboard
9. GET  /leaderboard/:testId/my-rank   → Show user's rank
```

### Flow 2: Student Buys & Takes a PAID Mock Test

```
1.  GET  /mock-tests                      → Show list, identify paid tests
2.  GET  /mock-tests/:id/check-access     → has_access: false, price: 199
3.  POST /payments/create-order           → { item_id, item_type: "MockTest" }
4.  [Frontend] Open Razorpay Checkout     → User pays
5.  POST /payments/verify                 → Verify signature → Purchase created
6.  GET  /mock-tests/:id/check-access     → has_access: true ✅
7.  POST /attempts/start                  → Start the test
8.  PUT  /attempts/:attemptId/answer      → Answer questions
9.  POST /attempts/:attemptId/submit      → Submit
10. POST /attempts/:attemptId/evaluate    → Get score
```

### Flow 3: Student Downloads a PDF

```
1. GET /resources                       → List all PDFs (free, login required)
2. GET /resources?resource_type=pdf     → Filter for PDFs only
3. GET /resources/:id/download          → Get signed download URL
4. [Frontend] Open URL in new tab       → Download starts
```

---

## 9. Data Models Reference

### Mock Test Object

```typescript
{
  _id: string;
  title: string;
  description?: string;
  access_type: "free" | "paid";      // ✨ NEW
  price: number;                      // ✨ NEW (0 for free, > 0 for paid)
  difficulty: "easy" | "medium" | "hard";
  total_questions: number;
  total_marks: number;
  passing_marks: number;
  duration_minutes: number;
  negative_marking: boolean;
  negative_marks_per_wrong: number;
  category?: string;                  // ObjectId
  course?: string;                    // ObjectId (optional, not required)
  is_active: boolean;
  questions: Question[];              // answers hidden for students
  createdAt: string;
  updatedAt: string;
}
```

### Resource (PDF) Object

```typescript
{
  _id: string;
  title: string;
  description?: string;
  resource_type: "pdf" | "video" | "notes" | "assignment" | "solution";
  course?: string;         // Optional — no longer required
  category?: string;       // ✨ NEW — optional, for standalone organization
  file_url: string;
  is_active: boolean;
  createdAt: string;
}
```

### Leaderboard Entry Object

```typescript
{
  rank: number;
  user: {
    _id: string;
    full_name: string;
    email: string;
    profile_picture?: string;
  };
  best_score: number;
  best_percentage: number;
  total_attempts: number;
  last_attempt_at: string;
}
```

### Purchase Object

```typescript
{
  _id: string;
  user: string;
  item_id: string | MockTest | Course;  // Populated when fetched
  item_type: "MockTest" | "Course";
  payment: string;
  amount: number;
  status: "ACTIVE" | "EXPIRED" | "REFUNDED";
  purchase_date: string;
  createdAt: string;
}
```

---

## 10. Error Codes Reference

| Status | Code | Endpoint | Meaning |
|--------|------|----------|---------|
| `400` | Bad Request | `POST /payments/create-order` | Item is free / already purchased / invalid type |
| `400` | Bad Request | `POST /attempts/start` | Max 3 attempts reached |
| `401` | Unauthorized | All protected routes | Missing or invalid JWT token |
| `403` | Forbidden | `POST /attempts/start` | Paid test not purchased |
| `404` | Not Found | Various | Test / Resource / Order not found |

### Standard Response Format

All endpoints return:
```json
{
  "statusCode": 200,
  "data": { ... },
  "message": "Human readable message",
  "success": true
}
```

Error responses:
```json
{
  "statusCode": 403,
  "message": "This is a paid test. Please purchase it first.",
  "success": false
}
```

---

## Quick Reference — All New Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/mock-tests/my/purchased` | Student | List purchased mock tests |
| `GET` | `/mock-tests/:id/check-access` | Student | Check if user can start test |
| `GET` | `/resources` | Student | List all PDFs (free) |
| `POST` | `/payments/create-order` | Student | Create Razorpay order (**updated**) |
| `POST` | `/payments/verify` | Student | Verify payment (**updated**) |
| `GET` | `/payments/my-purchases` | Student | List active purchases |
| `GET` | `/payments/my-history` | Student | Full payment history |
| `GET` | `/leaderboard/:testId` | Student | Paginated leaderboard (**updated**) |
| `GET` | `/leaderboard/:testId/my-rank` | Student | User's own rank |

---

*If you have questions, reach out to the backend team. Happy coding! 🚀*
