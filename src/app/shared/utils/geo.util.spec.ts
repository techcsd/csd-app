import { rumboEntre } from './geo.util';

describe('rumboEntre', () => {
  it('norte puro ≈ 0°', () => {
    expect(rumboEntre({ lat: 18.5, lng: -69.9 }, { lat: 18.6, lng: -69.9 })).toBeCloseTo(0, 0);
  });
  it('este puro ≈ 90°', () => {
    expect(rumboEntre({ lat: 18.5, lng: -69.9 }, { lat: 18.5, lng: -69.8 })).toBeCloseTo(90, 0);
  });
  it('sur puro ≈ 180°', () => {
    expect(rumboEntre({ lat: 18.6, lng: -69.9 }, { lat: 18.5, lng: -69.9 })).toBeCloseTo(180, 0);
  });
  it('oeste puro ≈ 270°', () => {
    expect(rumboEntre({ lat: 18.5, lng: -69.8 }, { lat: 18.5, lng: -69.9 })).toBeCloseTo(270, 0);
  });
});
