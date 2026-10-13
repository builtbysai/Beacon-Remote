# Appearance selection across browser layouts

The old Appearance label and platform-native select used a different visual
presentation on desktop and an invisible select over a text glyph on phones.
Replace both public and workspace controls with one appearance button and a
small panel containing System, Light, and Dark choices. Desktop shows the current
choice beside its icon; narrow screens keep a 44-pixel icon button with the same
accessible name and the same labeled choices. Choice rows are at least 54 pixels
high. The panel uses the existing theme color tokens, including focused and
selected states; selected appearance is also indicated by a checkmark.

This is a three-choice preference, so a binary light/dark switch would lose the
system preference. Native radios inside a labeled fieldset preserve browser
keyboard and screen reader semantics. Opening focuses the selected choice;
arrow keys change it. Escape closes and returns to the button; clicking outside
or moving focus outside closes it without trapping focus. The panel stays open
while changing appearance so keyboard users can continue comparing choices.

System remains the default and continues following OS appearance changes.
Explicit choices persist locally for this browser origin. Unavailable storage
does not prevent changing appearance, and unsupported saved values fall back to
System. No account preference or server transmission is added.

The decision draws on [W3C's radio group pattern](https://www.w3.org/WAI/ARIA/apg/patterns/radio/),
[Apple's Dark Mode guidance](https://developer.apple.com/design/human-interface-guidelines/dark-mode),
and [Fluent's design token guidance](https://fluent2.microsoft.design/design-tokens).
These sources support the semantics, system preference, and adaptive colors;
the exact compact button/panel design is Beacon's design choice.

This change covers the responsive browser application. Native Windows host
appearance is a separate implementation; physical Android/iOS and assistive
technology acceptance must not be inferred from browser layout checks.
