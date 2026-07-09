# Product Requirements Document (PRD)

**Mobile Barcode & Serial Number Scanning Utility  
For Centralized Warehouse Inventory Management**

# 1\. Project Overview & Objectives

This document outlines the architecture, security logic, and UI/UX requirements for a Progressive Web App (PWA) designed to handle high-volume barcode and QR code scanning. The utility will seamlessly facilitate automated serial number tracking for warehouse inbounds and outbounds. It emphasizes lightweight performance for maximum mobile device compatibility and utilizes role-based access controls to maintain data security within the broader centralized inventory management system.

# 2\. Technology Stack & Estimated Timeframes

Frontend: React (Vite), Tailwind CSS, Lucide React (for lightweight icons), and a robust local scanner API (Html5Qrcode/QuaggaJS).  
Backend: Supabase (PostgreSQL) for rapid automated schema deployment, instant API connectivity, and native Row Level Security (RLS).  
Estimated AI-Assisted Development Time: 2 to 4 hours.

# 3\. User Roles & Permissions

The system utilizes two primary roles to ensure data integrity and simplified user experiences:

- **DSA (Data Scanning Agent):** Access is strictly restricted to scanning items and exporting their own personal scan history. They cannot view aggregate branch data.
- **SCR (Senior Central Reviewer / Branch Manager):** Elevated access capable of scanning, exporting, and viewing aggregate lists of all scans performed by any DSA within their assigned branch.

# 4\. Database Architecture (Supabase Schema)

The relational schema consists of three primary tables:

**Table: branches  
**• id (UUID, Primary Key)  
• name (Text) - e.g., "North Warehouse"

**Table: profiles  
**• id (UUID, Primary Key, links to Auth)  
• role (Text) - strictly constrained to 'SCR' or 'DSA'  
• branch_id (UUID, Foreign Key -> branches.id)

**Table: scans  
**• id (UUID, Primary Key)  
• barcode (Text) - Scanned serial number  
• scanned_by (UUID, Foreign Key -> profiles.id)  
• branch_id (UUID, Foreign Key -> branches.id)  
• created_at (Timestamp)

# 5\. Row Level Security (RLS) Policies

The following PostgreSQL RLS policies enforce the access rules securely at the database level:

Policy A: Allow Authenticated Inserts (Scanning)

Ensures users can only insert records logically tied to their own user ID.

CREATE POLICY "Allow authenticated inserts" ON public.scans FOR INSERT TO authenticated WITH CHECK (auth.uid() = scanned_by);

Policy B: Role-Based Read Access (Lists & Exports)

Ensures DSAs only see their own warehouse scans, while SCRs can view all scans associated with their assigned branch.

CREATE POLICY "Allow role-based select" ON public.scans FOR SELECT TO authenticated USING (  
auth.uid() = scanned_by  
OR  
EXISTS (  
SELECT 1 FROM public.profiles  
WHERE profiles.id = auth.uid()  
AND profiles.role = 'SCR'  
AND profiles.branch_id = scans.branch_id  
)  
);

# 6\. UI/UX AI Developer Prompt

The following prompt should be supplied to an AI developer (e.g., Google Antigravity) to generate the precise frontend structure.

Act as an Expert UX/UI Designer and Frontend React Developer. Build the frontend for a lightweight, mobile-first Progressive Web App (PWA) used for high-volume barcode and QR code scanning.  
<br/>The app must be built using React (Vite), Tailwind CSS, and Lucide React for lightweight icons. The performance must be highly optimized for older, lower-end mobile devices.  
<br/>\### 1. Global Design System  
\* Layout: Strictly mobile-first. Max-width of 480px centered on larger screens, taking up 100% width on mobile.  
\* Typography: Use a clean, highly legible sans-serif font (Inter or system default).  
\* Touch Targets: All clickable elements (buttons, inputs) MUST have a minimum height of 48px to ensure easy tapping on small screens.  
\* Color Palette:  
\- Background: Off-white/Light Gray (bg-gray-50) to reduce glare.  
\- Primary Action (Scan): Vibrant Blue or Green (e.g., bg-blue-600) for high visibility.  
\- Secondary Actions (Export, Lists): Dark Gray or Neutral (bg-gray-800).  
\- Feedback States: Success Green (bg-green-500) for valid scans, Error Red (bg-red-500) for failures.  
<br/>\### 2. State & User Logic  
Assume a mock authentication state with two user roles: DSA (Standard user) and SCR (Branch Manager).  
\* A DSA user only has access to "Scan" and "Export \[My Scans\]".  
\* An SCR user has access to "Scan", "Export \[Branch Scans\]", and "Lists".  
<br/>\### 3. Required Screens & Components  
<br/>\#### Screen 1: Login & Setup  
\* Clean, minimalist login form centered on the screen (Email/Password).  
\* Upon initial login, present a clean Dropdown menu for "Select Branch" and a "Continue" button.  
<br/>\#### Screen 2: The Dashboard (Role-Based)  
\* Header: "Welcome, \[User\]" and a small tag indicating their role and branch.  
\* Primary Action: A massive, highly prominent "SCAN" button dominating the top half of the screen. Include a camera icon.  
\* Conditional Rendering:  
\- If DSA: Display a secondary button: "EXPORT MY SCANS".  
\- If SCR: Display two secondary buttons: "EXPORT BRANCH SCANS" and "VIEW BRANCH LISTS".  
<br/>\#### Screen 3: The Scanner View  
\* UI: Full-screen camera viewfinder using a library like html5-qrcode.  
\* Overlay: A translucent dark overlay with a clear, transparent square in the center indicating where the user should align the barcode.  
\* Controls: A distinct "Back to Dashboard" button at the top left.  
\* UX Feedback: When a scan is successful, briefly flash the screen edge green, play a mock success sound (if applicable), and display a temporary Toast notification at the bottom saying "Scanned: \[Barcode Number\]".  
\* Continuous Scanning: The scanner should not close after one scan; it should log the item and immediately be ready for the next one.  
<br/>\#### Screen 4: Lists View (SCR Only)  
\* A clean list/table displaying recently scanned items for the branch.  
\* List Items: Show the Barcode Number, Timestamp, and the Name/ID of the DSA who scanned it.  
\* Sticky Action: A sticky "Export Full List" button at the bottom of the screen so the SCR doesn't have to scroll all the way down to export.  
<br/>\### 4. Accessibility & Performance Constraints  
\* Do not use heavy animations or transitions. Keep state changes instant.  
\* Ensure high contrast between text and background colors (WCAG AA standard).  
\* Implement visual feedback (loading spinners, disabled button states) whenever an "Export" or "Submit" action is processing.