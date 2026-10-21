import { describe, expect, it } from 'vitest';
import { buildTranslationRequest, scanEgressText } from './translation.server';

describe('scanEgressText', () => {
  it('blocks contact details before egress', () => {
    expect(scanEgressText('Questions? Write to guest-contact@example.com any time.')).toBe('contact');
    expect(scanEgressText('Call the host on +49 30 901820 if anything is wrong.')).toBe('contact');
    expect(scanEgressText('Reach us on 0049 (0)30 901820 during the day.')).toBe('contact');
  });

  it('blocks secret-like prose before egress', () => {
    expect(scanEgressText('Le code de la porte est CAFÉ.')).toBe('secret');
    expect(scanEgressText('The door code is BLUEBIRD.')).toBe('secret');
    expect(scanEgressText('WLAN password: 4821')).toBe('secret');
    expect(scanEgressText('Use access code 9182 at the gate.')).toBe('secret');
    expect(scanEgressText('Backup key 3fa85f64c19b2a7d is in the lockbox.')).toBe('secret');
    expect(scanEgressText('Token A7fK2mQ9xL4bNv8rZt opens the garage.')).toBe('secret');
  });

  it('blocks labelled credential assignments in every supported language, including qualified labels', () => {
    // Every value here is lowercase with no digits, so only the assignment branch can block it.
    expect(scanEgressText('Wi-Fi password: summerhouse')).toBe('secret');
    expect(scanEgressText('Password: sunflowers')).toBe('secret');
    expect(scanEgressText('WLAN-Passwort: ferienhaus')).toBe('secret');
    expect(scanEgressText('Geslo za Wi-Fi: poletje')).toBe('secret');
    expect(scanEgressText('Mot de passe Wi-Fi : plage')).toBe('secret');
    expect(scanEgressText("Code d'accès : soleil")).toBe('secret');
    expect(scanEgressText('Contraseña del Wi-Fi: playa')).toBe('secret');
    expect(scanEgressText('Código de la puerta: girasol')).toBe('secret');
    expect(scanEgressText('Code Wi-Fi : plage')).toBe('secret');
    expect(scanEgressText('Clé wifi : plage')).toBe('secret');
    expect(scanEgressText('Digicode : soleil')).toBe('secret');
    expect(scanEgressText('Code de la boîte à clés : soleil')).toBe('secret');
    expect(scanEgressText('Clave de la puerta: girasol')).toBe('secret');
    expect(scanEgressText('Código del portal: girasol')).toBe('secret');
    expect(scanEgressText('Código de la caja de llaves: girasol')).toBe('secret');
    expect(scanEgressText('Password for guest Wi-Fi: summerhouse')).toBe('secret');
    expect(scanEgressText('WLAN-Passwort für Gäste: ferienhaus')).toBe('secret');
    expect(scanEgressText('Password for the apartment door: sunflowers')).toBe('secret');
    expect(scanEgressText('Zugangscode: gartentor')).toBe('secret');
    expect(scanEgressText('PIN: violet')).toBe('secret');
    expect(scanEgressText('Password = sunflowers\nis the current one.')).toBe('secret');
  });

  it('leaves ordinary guide prose alone', () => {
    expect(scanEgressText('Check-in is from 15:00. The key box is beside the gate.')).toBeNull();
    expect(scanEgressText('Route 66 and the old town are a ten minute walk away.')).toBeNull();
    expect(scanEgressText('The access code is sent by SMS before arrival.')).toBeNull();
    expect(scanEgressText('Map: https://maps.app.goo.gl/xYz123abc shows the parking spot.')).toBeNull();
    expect(scanEgressText('Weekly market on Saturday, 8:00 to 12:00, at the main square.')).toBeNull();
    expect(scanEgressText('Das WLAN-Passwort erhalten Sie bei der Ankunft.')).toBeNull();
    expect(scanEgressText('Das WLAN-Passwort für Gäste erhalten Sie bei der Ankunft.')).toBeNull();
    expect(scanEgressText('Password for the Wi-Fi is handed over at check-in.')).toBeNull();
    expect(scanEgressText('Der Zugangscode wird Ihnen bei der Ankunft mitgeteilt.')).toBeNull();
    expect(scanEgressText('Der Zugangscode steht in der Mappe. Für die Garage: siehe Seite 4.')).toBeNull();
    expect(scanEgressText('Geslo prejmete po SMS-u pred prihodom.')).toBeNull();
    expect(scanEgressText('Le mot de passe est envoyé par SMS avant votre arrivée.')).toBeNull();
    expect(scanEgressText('Recibirá la contraseña por SMS antes de llegar.')).toBeNull();
    expect(scanEgressText('Le code wifi est sur le routeur.')).toBeNull();
    expect(scanEgressText('La clave del éxito es descansar.')).toBeNull();
    expect(scanEgressText('Koda za vrata se spremeni ob vsaki prijavi.')).toBeNull();
  });
});

describe('buildTranslationRequest', () => {
  it('serializes exactly the translated fields with the plain-text format', () => {
    const request = buildTranslationRequest(['Wi-Fi', 'Network name: villa-guest'], 'en', 'de');
    expect(request).toEqual({
      contents: ['Wi-Fi', 'Network name: villa-guest'],
      mimeType: 'text/plain',
      sourceLanguageCode: 'en',
      targetLanguageCode: 'de',
    });
    expect(Object.keys(request)).toEqual(['contents', 'mimeType', 'sourceLanguageCode', 'targetLanguageCode']);
  });
});
