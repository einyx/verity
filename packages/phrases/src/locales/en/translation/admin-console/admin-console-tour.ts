const admin_console_tour = {
  next: 'Next',
  previous: 'Back',
  done: 'Got it',
  close: 'Skip tour',
  welcome: {
    title: 'Welcome to your admin console',
    description:
      'Here is a quick look at your sign-in page, website editor, and leads. Nothing will be changed, and you can close this tour at any time.',
  },
  sign_in_experience: {
    title: 'Your sign-in page',
    description:
      'Sign-in experience is where you customize the page people see when they log in. Set your logo, colors, and sign-in methods, then preview and save when you are ready. You do not need to configure anything now.',
  },
  landing_page: {
    title: 'Your landing page editor',
    description:
      'Landing page is the editor for your public website, separate from the sign-in page. Arrange sections, edit text and images, and preview your draft. Publishing makes your changes public; this tour does not publish anything.',
  },
  leads: {
    title: 'Your leads',
    description:
      'Leads brings together contacts captured by the landing page demo chat. Review their details, filter the list, and follow their progress through lead stages. You can come back here whenever you are ready.',
  },
};

export default Object.freeze(admin_console_tour);
