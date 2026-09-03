Subject: Conference App — Data, Deployment & Security Overview

Hi Kaitlyn,

Thanks for looping me in — once that folder is shared, I'll get started right away. Looking forward to working with you on this.

**Data collection**

Any data a user enters into the app will be stored, and all of it will be optional to provide:

- First name
- Social handle
- Picture
- Questions submitted to an admin
- Email (see the Security section below for more detail)

I'm currently running this on a free Supabase database; their terms of service are available [here](https://supabase.com/terms). Right now, only I have access to that account, though we could set up a separate account under church credentials if that's preferred. My plan is to wipe the database and delete the Supabase project about a week after the conference — let me know if you have guidance on data retention we should follow instead.

Below are some initial considerations for how we build this out. I'm sure there's more, so please flag anything that comes to mind or any questions you have — happy to adjust as needed.

**1. App Deployment**

The simplest path is to launch on the Apple App Store and Google Play Store for the duration of the conference and remove it afterward. If the church has an existing developer account or licensing arrangement, we could use that to avoid the fees; otherwise, Apple's developer program is $99/year and Google Play's is a $25 one-time registration fee. The app itself would be free to download and would take up a modest amount of phone storage — typically in the tens of megabytes for an app like this. We'd need to submit well in advance of the conference to allow time for store review. I'd like to have the app complete and submitted, with testing done, by the end of August at the latest — very doable on our current timeline.

Alternatively, we could build it as a web application, accessed through a browser (Chrome, Safari, etc.) rather than downloaded. This could potentially reduce or eliminate store fees, though I'd want to confirm hosting costs. Users wouldn't need to install anything, but there are real reliability concerns with camera-based QR scanning in a browser — it may need extra engineering work to function consistently — and we wouldn't be able to push notifications to individual users. It's a viable option, but it will feel noticeably more limited than a native app.

**2. Timeline / Work Remaining**

Ideally, development wraps up by the end of July, leaving August for testing and bug fixes. The UI doesn't need to be finished by then, but the backend does. That includes:

- Meeting Apple and Google Play store requirements (permission descriptions, account deletion support, etc.)
- Managing network load so the app and backend stay stable when many people are active at once
- Security (see below)
- Optimizations for same-day, walk-up registration
- Keeping our attendee data in sync with Eventbrite so last-minute registrants aren't locked out

**3. Security**

This probably deserves a longer, in-person conversation, but a few initial thoughts:

- We'll restrict app access to registered attendees by checking the email they used to sign up on Eventbrite. That means attendee emails will be stored in our Supabase database — a use of their data they haven't explicitly agreed to for this purpose. Other attendees won't be able to see this information, but it's worth deciding whether we disclose this somewhere upfront, like the Eventbrite listing or confirmation email.
- We won't be verifying the accuracy of anything users enter (name, photo, social handle), so we should make clear to attendees that they should use good judgment about what they share.
- The app will need camera access for the QR scanning feature to work.

Best,
Jason Yu
