describe('standalone Shop links to Pubky App', () => {
  it('hands a legacy profile link to the App with its query', () => {
    cy.request({ url: '/profile/alice/posts?tag=one&tag=two', followRedirect: false }).then((response) => {
      expect(response.status).to.eq(307);
      const destination = new URL(String(response.headers.location));
      expect(destination.pathname).to.eq('/profile/alice');
      expect(destination.searchParams.getAll('tag')).to.deep.eq(['one', 'two']);
      expect(destination.origin).not.to.eq(new URL(Cypress.config('baseUrl')!).origin);
    });
  });

  it('rejects a POST to the retired share target', () => {
    cy.request({ method: 'POST', url: '/share', body: 'example', followRedirect: false, failOnStatusCode: false })
      .its('status')
      .should('eq', 405);
  });
});
