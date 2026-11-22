---
"mesh-avatar": minor
---

Add optional `rig.head.weightOutline` (a polygon around the head, hair and neck) and `rig.head.weightFeather` (px, default 16). Outside the outline the head's roll and turn influence fades to zero over the feather, so a hand raised beside the head stays with the body when the head tilts or turns. Avatars without the outline deform exactly as before.
