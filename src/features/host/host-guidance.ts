import type { SectionCategory } from '../guide/guide-validation';

export const categoryIdeas: Record<SectionCategory, string[]> = {
  arrival: [
    'How to reach the door: key box location and steps, door or gate codes, entrance floor.',
    'Where to park or drop luggage on arrival, and what to do if the guest arrives early or late.',
    'A phone number to call if they cannot get in.',
  ],
  wifi: [
    'Network name and password, spelled exactly as they appear on the router.',
    'Where the router is, and what to restart if the connection drops.',
  ],
  parking: [
    'Where to park, how many spaces, and whether it is free or needs a permit.',
    'Gate or garage instructions, height limits, and nearby alternatives.',
  ],
  rules: [
    'Quiet hours, smoking, pets, and the number of guests allowed.',
    'Anything that costs money if broken or left behind.',
  ],
  appliances: [
    'Heating or air conditioning: where the control is and what temperature is fine.',
    'Oven, washing machine, dishwasher, coffee machine: the one step guests usually get wrong.',
    'Where the fuse box and water shut-off are.',
  ],
  waste: ['Which bins are for what, and where they stand.', 'Collection days, and where to leave bags on checkout.'],
  checkout: [
    'Checkout time and whether a late checkout can be arranged.',
    'A short list: windows closed, heating down, towels in one place, keys back in the box.',
  ],
  emergency: [
    'Local emergency number, nearest hospital and pharmacy.',
    'Your phone number and a backup contact for when you are unreachable.',
    'Where the first-aid kit and fire extinguisher are.',
  ],
  local_tips: [
    'Two or three places you would send a friend: a restaurant, a shop, a walk.',
    'Nearest supermarket and its opening hours, public transport, and taxis.',
  ],
};

export const helpSteps = [
  {
    title: 'Fill in the essentials',
    body: 'Open a property and complete Basics: check-in and checkout times, address, contact phone and Wi-Fi. These are what guests look for first.',
  },
  {
    title: 'Write the key sections',
    body: 'Start with Arrival and access and Emergency contacts, then add whatever guests ask about most. Short, concrete steps beat long paragraphs.',
  },
  {
    title: 'Check the guest preview',
    body: 'The preview shows the guide in a phone frame exactly as guests see it. Look for missing details a stranger could not guess.',
  },
  {
    title: 'Publish and share the link',
    body: 'Publish the guide, then create the guest link. Copy it, or print the QR card and put it in the flat. The link is shown only once, so copy it straight away.',
  },
  {
    title: 'Answer what guests ask',
    body: 'Questions and issue reports land in the inbox, and you get one email alert per message. Mark them handled, and add an answer to the guide when the same question comes back.',
  },
] as const;
