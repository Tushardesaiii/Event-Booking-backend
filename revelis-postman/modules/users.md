# Module: Users & Profiles

Provides endpoints to fetch and modify user profile metadata, buddy settings, reviews, and saved events.

- `GET /profiles/me`: Retrieve current user profile.
- `PATCH /profiles/me`: Update user details (bio, preferences).
- `POST /profiles/me/avatar`: Presign avatar asset link.
- `POST /profiles/me/cover`: Presign cover asset link.
- `GET /profiles/:username`: Fetch public profile for a user.
- `POST /profiles/:username/follow`: Follow/Unfollow.
