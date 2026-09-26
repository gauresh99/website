/**
 * All site copy. Facts trace to CONTENT-BRIEF.md; shape is fixed by CONTRACT.md.
 * Voice: first person, told as things that happened, not summarised about me.
 */
export const CONTENT = Object.freeze({
  person: {
    name: 'Gauresh Maheshwary',
    role: 'Senior in Computer Engineering at UIUC',
    tagline: 'Experienced in Embedded Systems / Firmware and AI / ML',
    location: 'Champaign, Illinois',
    email: 'gaureshmaheshwary@gmail.com',
    links: [
      { label: 'GitHub', href: 'https://github.com/gauresh99', kind: 'github' },
      { label: 'LinkedIn', href: 'https://linkedin.com/in/gauresh-maheshwary19', kind: 'linkedin' },
      { label: 'Email', href: 'mailto:gaureshmaheshwary@gmail.com', kind: 'email' },
    ],
  },

  about: {
    greeting: "Hi, I'm Gauresh :)",
    lead:
      'I like solving problems around me, although my definition of a "problem" ' +
      'has changed quite a bit over the years.',
    body: [
      "When I was four, my friends and I decided none of the sports we played were " +
      "quite chaotic or creative enough. So I invented one. We called it Tunnel, and " +
      "the best way I can describe it is dodgeball on crack: bits and pieces of " +
      "different sports stitched together into something we found infinitely more " +
      "fun. More than fifteen years later, kids in my neighbourhood still play it.",

      "I obviously wasn't thinking about engineering back then, but the instinct has " +
      "stayed consistent. See something that could be better, obsess over it for a " +
      "while, try to build a solution.",

      "Years later that became much more meaningful. My grandfather's brother had " +
      "difficulty operating the joystick on his powered wheelchair, and in high " +
      "school I started wondering whether I could do something about it. That became " +
      "Sakha: a kit that converted a manual wheelchair into a motorised one with " +
      "phone-based voice control. I designed its motor controller and brought the " +
      "cost down from ₹48,000 to ₹29,999.",

      "Building Sakha was when technology clicked for me. For the first time I saw " +
      "that engineering wasn't just about making something technically impressive. It " +
      "could solve a real problem for someone standing right in front of me. Watching " +
      "something I had built make another person's life a little easier was unlike " +
      "anything I'd felt before, and I've been chasing versions of that feeling ever " +
      "since.",

      "Today I'm studying Computer Engineering at the University of Illinois " +
      "Urbana-Champaign, with minors in Mathematics and Business Studies. Somewhere " +
      "along the way I fell particularly in love with the lowest layers of computing. " +
      "I enjoy understanding what happens between a line of C and the physical " +
      "hardware underneath it: processors, interrupts, memory, peripherals, control " +
      "systems, FPGAs, and all the wonderfully strange things that happen when " +
      "software finally meets the real world. Put simply, I like building things that " +
      "make hardware come alive.",

      "More than anything, I'm still the kid who made up a game because the existing " +
      "ones weren't quite good enough. I like noticing things that don't work as well " +
      "as they could, asking why does it have to be this way, and seeing whether I " +
      "can build something better. Hopefully I get to spend a very long time doing " +
      "exactly that.",
    ],

    /* Right-hand column: the half of me that isn't engineering. */
    aside: {
      title: 'Off the clock',
      body: [
        "I've played football most of my life and probably spend an unreasonable " +
        "amount of time watching it too. Lionel Messi is my favourite player, FC " +
        "Barcelona is my club, and football gave me some of my favourite memories " +
        "growing up. I was selected for an India U-19 national team training camp " +
        "alongside 65 players from across the country, and I was lucky enough to be a " +
        "paid athlete while still in high school.",

        "Football has shaped how I work more than I probably realise. Compete " +
        "seriously, trust the people around you, lose without making excuses, and " +
        "come back wanting another game.",

        "When I'm not building something or watching football, you'll find me on " +
        "sitcoms, rom-coms, Game of Thrones, or anime. I'm also committed to the " +
        "extremely important lifelong responsibility of discovering the One Piece.",
      ],
      /* The link back into the shootout. */
      invite: {
        lead:
          "I've hung up the boots professionally, but football never quite left. It " +
          "runs through this whole site: my portfolio is a penalty shootout, and every " +
          "project is a panel in the goal.",
        cta: 'Fancy a penalty?',
        href: '#shootout',
      },
    },
  },

  /* The journey. Ordered oldest to newest; `projectId` makes an entry clickable
     through to its full write-up in the projects section. */
  timeline: [
    {
      id: 'sakha',
      date: '2019 – 2023',
      title: 'Sakha',
      org: 'Founder, high school',
      kind: 'venture',
      image: 'assets/sakha-web.jpg',
      projectId: 'sakha-wheelchair',
      summary:
        "I built Sakha in high school for my grandfather's brother: a retrofit kit " +
        "that motorises a manual wheelchair, with an app letting you drive it by " +
        "voice or keypad. It came in at about half the price of the cheapest " +
        "motorised wheelchair on the market.",
    },
    {
      id: 'independent-research',
      date: '2019 – 2023',
      title: 'Independent research',
      org: 'Extended essay',
      kind: 'research',
      summary:
        "LLMs were just booming and I wanted my research paper to sit in that field " +
        "but say something less obvious. I landed on personalised models: data was " +
        "the vast problem, but training was solvable. So I compared cross-validation " +
        "against LOGOCV across models I wrote and open-source ones, including a " +
        "breast cancer detection model.",
    },
    {
      id: 'uiuc',
      date: '2023 – 2027',
      title: 'UIUC, Computer Engineering',
      org: 'Urbana-Champaign',
      kind: 'education',
      image: 'assets/uiuc-web.jpg',
      summary:
        "One of the biggest decisions of my life: leaving my family and friends for a " +
        "country I had never set foot in, on the bet that I could chase what I wanted " +
        "better from here. I came for the cutting edge, and for the chance to point it " +
        "at more of the problems around me.",
    },
    {
      id: 'intai',
      date: 'Jan 2024',
      title: 'INTAI',
      org: 'Two of us',
      kind: 'project',
      projectId: 'intai-mock-interview',
      summary:
        "At a career fair I noticed how long the queues were for the resume checks and " +
        "mock interviews the university ran. So: use AI to run the mock interview " +
        "instead, technical and behavioural. A school friend and I ground for a month " +
        "and got it working with live confidence and tonality tracking, and an " +
        "understanding of what your resume actually claims.",
    },
    {
      id: 'bldc',
      date: 'May 2024',
      title: 'BLDC motor control',
      org: 'Radius Synergies International, Noida',
      kind: 'work',
      projectId: 'bldc-drv1098x-bringup',
      summary:
        "My first internship, where embedded meets hardware. I worked under a senior " +
        "engineer with 25 years behind him, learning BLDC motors and driving exhaust " +
        "speed control through back-EMF sensing on the DRV10983.",
    },
    {
      id: 'lc3',
      date: 'Feb 2025',
      title: '16-bit LC-3 processor',
      org: 'ECE 385',
      kind: 'project',
      projectId: 'slc3-processor',
      summary:
        "A multi-cycle LC-3 subset processor in SystemVerilog on an AMD Spartan-7, " +
        "with an FSM control unit, register-file datapath, ALU and memory-mapped I/O. " +
        "Closed timing at 108.8 MHz on 376 LUTs and 344 flip-flops with no inferred " +
        "latches, verified by running real LC-3 assembly including self-modifying code.",
    },
    {
      id: 'air-hockey',
      date: 'Apr 2025',
      title: 'FPGA air hockey',
      org: 'ECE 385 final project',
      kind: 'project',
      image: 'assets/pong-web.jpg',
      projectId: 'fpga-air-hockey',
      summary:
        "Two-player air hockey on a Spartan-7 with a MicroBlaze soft core and " +
        "SystemVerilog accelerators for ball physics and collision. USB-HID keyboard " +
        "over SPI, 640×480 HDMI, PWM audio, and four simultaneous keys so neither " +
        "player blocks the other. The opponent tracks your return error across rallies " +
        "and adapts.",
    },
    {
      id: 'omnie',
      date: 'May 2025',
      title: 'ML Applications Intern',
      org: 'Omnie Solutions, Noida',
      kind: 'work',
      summary:
        "ML applications for Aumcore, a New York marketing client serving 50+ " +
        "companies. I integrated a keyword-recommendation pipeline over trend data and " +
        "locally hosted models, with campaign performance from Instagram, Meta and " +
        "Google Ads feeding back in, plus attribution reporting tying each " +
        "recommendation to its rationale.",
    },
    {
      id: 'ece391',
      date: 'Nov 2025',
      title: 'Unix-like operating system',
      org: 'ECE 391, team of three',
      kind: 'project',
      projectId: 'ece391-os',
      summary:
        "Major components of a Unix-like OS in C and RISC-V assembly. An ext2-inspired " +
        "filesystem with direct, indirect and doubly-indirect addressing, a 64-block " +
        "write-back cache with dirty-bit tracking and block pinning, plus round-robin " +
        "scheduling, timer-driven preemption and synchronisation.",
    },
    {
      id: 'stat420',
      date: 'Apr 2026',
      title: 'Credit limit modelling',
      org: 'STAT 420',
      kind: 'project',
      summary:
        "A statistical model in R predicting credit limits from demographic and " +
        "payment data on the UCI Credit Card Clients dataset. Interaction terms tested " +
        "with ANOVA, predictors chosen by BIC, validated with leave-one-out CV. I also " +
        "looked at the fair-lending concerns around demographic predictors and what a " +
        "single-market dataset can't tell you.",
    },
    {
      id: 'mechse',
      date: 'Summer 2026',
      title: 'Reduced-order models for HVAC',
      org: 'MechSE, UIUC — Prof. Xiaofei Wang',
      kind: 'research',
      summary:
        "Working remotely from India, I built regularized polynomial surrogates that " +
        "infer indoor conditions from outdoor-unit sensor signals, replacing a " +
        "30-minute physics simulation with roughly 20 ms inference at R² = 0.99. " +
        "Accurate enough for control, light enough to eventually live on " +
        "resource-constrained HVAC hardware.",
    },
    {
      id: 'vlasov',
      date: 'Fall 2027',
      title: 'Integrated Neurotechnology Lab',
      org: 'Prof. Yurii Vlasov, UIUC',
      kind: 'research',
      summary:
        "Next up: joining a lab building brain-interface technology for studying " +
        "electrical and chemical activity in neural systems. I expect to work on " +
        "microcontroller and sensor configuration, and to explore " +
        "cyclic-voltammetry-based molecular measurements against neural signals.",
    },
  ],

  /* `short` is the goal-panel label: at panel size a full project name is a
     texture, not a word, so each one gets a name you can read at a glance. */
  /* `short` is the goal-panel label: at panel size a full project name is a
     texture, not a word, so each one gets a name you can read at a glance. */
  projects: [
    {
      id: 'bldc-drv1098x-bringup',
      name: 'DRV1098x BLDC Bring-Up',
      short: 'BLDC',
      art: 'motor',
      body: [
        "This was probably the internship where embedded systems started feeling real to me.",
        "I worked almost entirely with one senior embedded engineer who had spent 25+ years on firmware, chips and telecom systems. A lot of my internship was honestly just following him around, asking questions, reading whatever datasheet he threw at me, and slowly understanding why he was making the decisions he was making. I learned more from watching him debug hardware and reason through a problem than I could have from another class.",
        "The actual project was turning a commercial BLDC fan into something that could eventually fit into a larger factory-automation system. By the end we had it configured for variable-speed reverse and exhaust operation, rather than the single exhaust mode it originally supported. The idea was simple but exciting: factories shouldn't have to run exhaust fans at full speed all the time. If the company's controller could command the motor based on actual demand, you could automate ventilation while keeping the efficiency of a BLDC motor.",
        "Seeing the fan finally run through the behaviour we had configured felt amazing. It was one of the first times I looked at something running in front of me and thought, this isn't just a lab any more. Someone could actually use this.",
      ],
      points: [
        'Characterized the motor and measured its back-EMF constant across its operating range.',
        'Configured TI DRV10983/DRV10987 sensorless BLDC drivers through their register map over I²C.',
        'Added multi-speed reverse operation and measured current consumption at each speed.',
      ],
      tech: ['C', 'Assembly', 'I²C', 'BLDC Motors', 'TI DRV10983/DRV10987', 'Back-EMF',
             'Register-Level Programming', 'Motor Control', 'Hardware Bring-Up', 'Datasheet Debugging'],
      repo: 'https://github.com/gauresh99/bldc-drv1098x-bringup',
    },
    {
      id: 'sakha-wheelchair',
      name: 'Sakha',
      short: 'Sakha',
      art: 'wheelchair',
      body: [
        "Sakha is probably the project that explains why I became an engineer in the first place.",
        "My grandfather's brother had difficulty using the joystick on his powered wheelchair, and I kept thinking there had to be a better way for him to control it. What started as a high-school project eventually became a retrofit kit that could turn a manual wheelchair into a motorised one, without forcing someone to buy an entirely new chair.",
        "The part I care about most wasn't making the chair move. It was thinking through what would happen when something went wrong. A voice-controlled wheelchair that listens to anyone is obviously a terrible idea, so commands were gated through speaker verification before being sent to the chair. And instead of letting a \"forward\" command latch indefinitely, the phone continuously refreshed it: if the app crashed, Bluetooth disconnected, or communication stopped, the motors stopped as well.",
        "It was the first project where I really understood that engineering isn't just about whether something works. It's about whether someone can trust it.",
      ],
      points: [
        'Built the control path from phone → HC-05 Bluetooth → Arduino → external motor driver.',
        'Implemented PWM-based motor speed and direction control.',
        'Integrated speaker verification and speech-to-text support for English and Hindi.',
        'Reduced the target system cost from roughly ₹48,000 to ₹29,999 through the retrofit approach.',
      ],
      tech: ['C', 'Python', 'Kotlin', 'Arduino', 'Bluetooth', 'HC-05', 'PWM', 'Motor Control',
             'Android', 'Speaker Verification', 'Speech-to-Text', 'Embedded Systems'],
      repo: 'https://github.com/gauresh99/sakha-wheelchair',
    },
    {
      id: 'intai-mock-interview',
      name: 'INTAI',
      short: 'INTAI',
      art: 'interview',
      body: [
        "Freshman year, a friend and I wanted to build something that could actually help someone practise interviews rather than just give them another list of questions.",
        "The problem was that this was 2023, and making an expensive model call after every answer wasn't realistic for two students building something on essentially no budget. So we designed the system around one OpenAI call per interview session.",
        "The model looked at the candidate's resume once and generated a personalised set of things they should realistically be able to talk about. From there, the rest of the interview ran on cheaper pipelines around speech, facial expressions, keywords and confidence signals.",
        "That constraint ended up making the project much more interesting. Instead of asking what is the fanciest model we can use, we had to ask where a model call actually adds enough value to justify its cost.",
      ],
      points: [
        'Used the OpenAI API once per session to derive a candidate-specific keyword set from an uploaded résumé.',
        'Integrated a pretrained facial-emotion classifier and built logic translating its output into interview confidence signals.',
        'Built a vocal-analysis pipeline around volume, speaking rate, and pause behavior.',
        'Used C data structures to track confidence information throughout the interview.',
      ],
      tech: ['Python', 'C', 'OpenCV', 'OpenAI API', 'Machine Learning', 'Audio Processing',
             'Computer Vision', 'APIs', 'Data Structures'],
      repo: 'https://github.com/gauresh99/intai-mock-interview',
    },
    {
      id: 'warret',
      name: 'Warret',
      short: 'Warret',
      art: 'receipt',
      body: [
        "Warret came from a very normal problem: I had warranties for things I owned and absolutely no idea where half of them were or when they expired.",
        "So I started building a place where you could photograph a receipt, save the warranty automatically, and then forget about it until the app told you something was about to expire.",
        "One of the things I enjoyed most was realising that even a simple consumer app can hide interesting engineering decisions. The app constantly asks some version of \"what expires next?\", so instead of repeatedly sorting every warranty, I built the timeline around a priority queue.",
        "I also didn't want to send every receipt straight into a model just because I could. Common receipt formats go through deterministic parsing first, and the model becomes the fallback. It made the architecture cheaper, simpler, and honestly more sensible.",
      ],
      points: [
        'Built the app with TypeScript, Expo, and Supabase.',
        'Used a binary min-heap to maintain upcoming warranty expirations.',
        'Moved receipt extraction and sensitive logic into Supabase Edge Functions rather than the client.',
        'Implemented row-level security for user-owned warranty data.',
      ],
      tech: ['TypeScript', 'Expo', 'Supabase', 'Edge Functions', 'Row-Level Security', 'Heaps',
             'Data Structures', 'Backend Architecture', 'API Integration'],
      repo: 'https://github.com/gauresh99/warret',
    },
    {
      id: 'slc3-processor',
      name: '16-bit Processor (LC-3 Subset)',
      short: 'LC-3',
      art: 'chip',
      body: [
        "I first met the LC-3 in ECE 120 as a student writing assembly for a processor someone else had designed. A couple of years later in ECE 385, I got to build the processor.",
        "That progression is probably why this project stuck with me so much. Things like fetch, decode, registers, ALUs and memory addressing stopped being boxes on a diagram and became signals I had to generate at exactly the right clock cycle. Suddenly, when a control signal changed one state too early, I understood what that meant to the instruction actually running.",
        "I implemented a subset of the LC-3 ISA, and I intentionally say subset. I would much rather describe exactly what I built and be able to go deep on it than make the title sound slightly more impressive and have to walk it back later.",
      ],
      points: [
        'Designed a multi-cycle processor in SystemVerilog with separate datapath and control logic.',
        'Built an 8-register datapath, ALU, synchronous memory interface, and FSM-based control unit.',
        'Implemented memory-mapped I/O to switches and a four-digit hex display.',
        'Closed timing at 108.8 MHz on an AMD Spartan-7 and verified the design by running real LC-3 assembly programs.',
      ],
      tech: ['SystemVerilog', 'RTL Design', 'Vivado', 'AMD Spartan-7', 'FPGA',
             'Computer Architecture', 'FSMs', 'Digital Logic', 'LC-3', 'Memory-Mapped I/O'],
      repo: null,
    },
    {
      id: 'fpga-air-hockey',
      name: 'FPGA Air Hockey',
      short: 'Air Hockey',
      art: 'arcade',
      body: [
        "This started as an ECE 385 final project with a lab partner and then became something I kept working on over the summer because I wasn't quite done with it.",
        "We built a two-player air-hockey game around a MicroBlaze soft processor and a Spartan-7 FPGA. What I liked most about the architecture was deciding what belonged in software and what belonged in hardware. The MicroBlaze handled orchestration in C, but ball physics and collision detection had to happen every frame with predictable timing, so those went into SystemVerilog accelerators in the fabric.",
        "It had an adaptive opponent for single player that watched how far from the ideal contact point a player returned the puck. If the error kept shrinking it made the game harder; if the player struggled it eased off. Over the summer I added multi-mode collision audio to make it more stimulating.",
      ],
      points: [
        'Ran a MicroBlaze-based system at 118.27 MHz, using 4,687 LUTs, 286 flip-flops, 16 DSPs, and 8 BRAMs.',
        'Offloaded ball physics and collision detection into SystemVerilog hardware.',
        'Interfaced a USB-HID keyboard through a MAX3421E over SPI and supported four simultaneous keypresses.',
        'Added 640×480 video output, AXI-connected peripherals, PWM audio, and the adaptive opponent.',
      ],
      tech: ['SystemVerilog', 'C', 'MicroBlaze', 'Vitis', 'Vivado', 'AXI', 'SPI', 'USB-HID',
             'FPGA', 'AMD Spartan-7', 'PWM', 'RTL Design', 'Hardware/Software Co-Design', 'Control Systems'],
      repo: null,
    },
    {
      id: 'ece391-os',
      name: 'Unix-like RISC-V OS',
      short: 'RISC-V OS',
      art: 'os',
      body: [
        "ECE 391 was probably the project that made me appreciate just how much software exists underneath something as simple as opening a file.",
        "Three of us built a Unix-V6-inspired operating system in C and RISC-V assembly. My part centred heavily around the filesystem, caching, scheduling and synchronisation.",
        "The piece I found most interesting was the buffer cache. Without it, the filesystem can simply read a block from disk whenever it needs one. Add caching and suddenly you have two versions of the same block, one in memory and one on disk, and now you have to think about dirty data, eviction, concurrent access, and what happens if something gets preempted halfway through.",
        "That project was one of those experiences where every feature you add seems to create three new ways the system can break. I loved it.",
      ],
      points: [
        'Built an ext2-inspired filesystem with direct, indirect, and doubly-indirect block addressing.',
        'Implemented a 64-block write-back buffer cache with dirty-bit tracking and block pinning.',
        'Added round-robin scheduling with timer-driven preemption.',
        'Worked on synchronization placement, condition variables, broadcast wakeups, and user-space filesystem utilities.',
      ],
      tech: ['C', 'RISC-V Assembly', 'QEMU', 'GDB', 'Operating Systems', 'Filesystems',
             'Buffer Caches', 'Concurrency', 'Scheduling', 'Synchronization', 'Virtual Memory',
             'Kernel Development'],
      repo: null,
    },
    {
      id: 'stylemind',
      name: 'StyleMind',
      short: 'StyleMind',
      art: 'wardrobe',
      body: [
        "StyleMind started as me wanting to understand what it actually feels like to build a consumer product end to end.",
        "The idea was straightforward: photograph the clothes you own, let the system understand things like colour, type, fit and formality, and use that to suggest outfits based on what you had worn recently, what was in the laundry, and what you were doing that day.",
        "The most useful thing the project gave me was actually a feature that failed. Fit classification looked fine when I tested it. Then real people used it. They photographed shirts hanging from doors, bunched on beds, worn on their bodies, at weird angles, under bad lighting, because people take photos to remember what a piece of clothing looks like, not to give a classifier a perfect view of its cut. The model wasn't necessarily the problem. My assumption about the data was.",
      ],
      points: [
        'Built a browser-based wardrobe and outfit recommendation experience.',
        'Used color, fit, formality, recent outfits, and laundry state as recommendation context.',
        'Designed the product to run locally in the browser without requiring an account or remote server.',
      ],
      tech: ['JavaScript', 'Browser APIs', 'Offline-First Applications', 'Product Development',
             'Recommendation Systems', 'ML Product Thinking', 'Data Distribution Analysis',
             'UX Experimentation'],
      repo: 'https://github.com/gauresh99/stylemind',
    },
  ],

  commentary: {
    goal: [
      'Bottom corner. The keeper never moved.',
      'Struck low and hard. No argument with that.',
      'Off the underside of the bar, and in.',
      'Picked his corner early and never changed it.',
      "Keeper went the right way. Didn't matter.",
      'Top corner. Nothing anyone could have done.',
      "Inside the post. That's all he needed.",
      'No theatrics in the run-up. Just placed it.',
      'Rolled in. Cheeky, at this pressure.',
      'He looked at the corner, then hit the corner.',
    ],
    miss: [
      'Wide. He knew before it left his foot.',
      "Over the bar. That one's still climbing.",
      'Dragged it. The standing foot went down first.',
      'Off the post and away. Inches.',
      'Leaned back on it. Always goes up.',
      'Side-netting, from the wrong side.',
      'Scuffed it. Took a divot with it.',
      'Changed his mind halfway through. Fatal.',
      'Long run-up, and short of the target.',
      'Right of the post. Comfortably right.',
    ],
    save: [
      'Saved. Low to his left, strong hand.',
      'Read it early. Barely had to stretch.',
      'Palmed away. Good height on the ball, though.',
      "Straight at him. He'll take it.",
      "Fingertips. That's all it takes.",
      'The keeper guessed, and guessed right.',
      'Blocked with a trailing leg. Whatever works.',
      'Stood up late and made the goal look small.',
      'Beaten out, and away from the rebound.',
      'Held it. No parry, no scramble.',
    ],
  },
});
