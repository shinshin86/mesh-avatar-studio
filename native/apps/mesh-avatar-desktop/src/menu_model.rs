//! Menu contents and command routing independent of AppKit.
use crate::menu::Command;
use mesh_avatar_core::engine::{expression::OVERLAY_EXPRESSIONS, motions::MotionDefinition};

pub struct Entry {
    pub id: String,
    pub label: String,
}
pub struct AvatarMenu {
    pub motions: Vec<Entry>,
    pub expressions: Vec<Entry>,
}
impl AvatarMenu {
    pub fn new(motions: &[MotionDefinition]) -> Self {
        Self {
            motions: motions
                .iter()
                .map(|m| Entry {
                    id: format!("motion:{}", m.id),
                    label: m.label.clone(),
                })
                .collect(),
            expressions: OVERLAY_EXPRESSIONS
                .iter()
                .map(|(name, _)| Entry {
                    id: format!("expression:{name}"),
                    label: match *name {
                        "neutral" => "Neutral",
                        "smile" => "Smile",
                        "shy" => "Shy",
                        "surprise" => "Surprise",
                        "halfLidded" => "Half-lidded",
                        "angry" => "Angry",
                        "sad" => "Sad",
                        "wink" => "Wink",
                        _ => name,
                    }
                    .to_string(),
                })
                .collect(),
        }
    }
    pub fn command(&self, id: &str) -> Option<Command> {
        if self.motions.iter().any(|e| e.id == id) {
            return id
                .strip_prefix("motion:")
                .map(|id| Command::Play(id.to_string()));
        }
        if self.expressions.iter().any(|e| e.id == id) {
            return id
                .strip_prefix("expression:")
                .map(|id| Command::Expression(id.to_string()));
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_motion_label_and_live_expression_is_routed_and_rebuild_discards_old_ids() {
        let motions: Vec<_> = (0..15)
            .map(|i| MotionDefinition {
                id: format!("m{i}"),
                label: format!("Motion {i} & more"),
                dur: 1.0,
                idle: false,
                tracks: vec![],
            })
            .collect();
        let menu = AvatarMenu::new(&motions);
        assert_eq!(menu.motions.len(), 15);
        assert_eq!(menu.motions[14].label, "Motion 14 & more");
        assert!(matches!(menu.command("motion:m14"),Some(Command::Play(id)) if id == "m14"));
        assert_eq!(menu.expressions.len(), OVERLAY_EXPRESSIONS.len());
        for (name, _) in OVERLAY_EXPRESSIONS {
            assert!(
                matches!(menu.command(&format!("expression:{name}")),Some(Command::Expression(id)) if &id == name)
            );
        }
        assert!(menu.command("expression:unknown").is_none());
        let rebuilt = AvatarMenu::new(&[]);
        assert!(rebuilt.command("motion:m14").is_none());
        assert_eq!(rebuilt.expressions.len(), OVERLAY_EXPRESSIONS.len());
    }
}
