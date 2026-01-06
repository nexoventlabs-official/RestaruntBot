import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

export default function About() {
  return (
    <div>
      {/* Hero Section */}
      <section 
        className="relative text-white py-16 bg-cover bg-center"
        style={{ backgroundImage: "url('/ct-bc.jpg')" }}
      >
        <div className="absolute inset-0 bg-black/50"></div>
        <div className="relative max-w-6xl mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">About Us</h1>
          <p className="text-lg text-gray-200 max-w-2xl mx-auto">
            Discover our story and passion for delivering delicious food to your doorstep
          </p>
        </div>
      </section>

      {/* Story Section */}
      <section className="py-12 md:py-16">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div data-animate="slide-left">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">Our Story</h2>
              <p className="text-gray-600 mb-4">
                FoodieSpot started with a simple idea: bring restaurant-quality food to people's homes without compromising on taste or freshness.
              </p>
              <p className="text-gray-600 mb-4">
                Founded in 2020, we've grown from a small kitchen to a beloved local food destination. Our team of passionate chefs works tirelessly to create dishes that bring joy to every meal.
              </p>
              <p className="text-gray-600">
                We believe that great food should be accessible to everyone. That's why we focus on using fresh, locally-sourced ingredients while keeping our prices affordable.
              </p>
            </div>
            <div className="rounded-3xl overflow-hidden" data-animate="slide-right">
              <img src="/our-story.png" alt="Our Story" className="w-full h-full object-cover" />
            </div>
          </div>
        </div>
      </section>

      {/* Values Section */}
      <section className="py-12 bg-white">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-gray-900 text-center mb-12" data-animate="fade-up">Our Values</h2>
          <div className="grid md:grid-cols-3 gap-8" data-animate="stagger">
            <div className="text-center p-6">
              <div className="w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-4xl">🌿</span>
              </div>
              <h3 className="font-semibold text-xl mb-2">Fresh Ingredients</h3>
              <p className="text-gray-500">
                We source the freshest ingredients daily from local suppliers to ensure quality in every dish.
              </p>
            </div>
            <div className="text-center p-6">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-4xl">❤️</span>
              </div>
              <h3 className="font-semibold text-xl mb-2">Made with Love</h3>
              <p className="text-gray-500">
                Every dish is prepared with care and passion by our experienced culinary team.
              </p>
            </div>
            <div className="text-center p-6">
              <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-4xl">⚡</span>
              </div>
              <h3 className="font-semibold text-xl mb-2">Quick Delivery</h3>
              <p className="text-gray-500">
                We ensure your food arrives hot and fresh with our efficient delivery system.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Team Section */}
      <section className="py-12 md:py-16">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-gray-900 text-center mb-4" data-animate="fade-up">Meet Our Team</h2>
          <p className="text-gray-500 text-center mb-12 max-w-2xl mx-auto" data-animate="fade-up">
            The passionate people behind your favorite dishes
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6" data-animate="stagger">
            {[
              { name: 'Chef Raj', role: 'Head Chef', emoji: '👨‍🍳' },
              { name: 'Priya', role: 'Sous Chef', emoji: '👩‍🍳' },
              { name: 'Amit', role: 'Pastry Chef', emoji: '🧁' },
              { name: 'Neha', role: 'Manager', emoji: '👩‍💼' },
            ].map((member, i) => (
              <div key={i} className="bg-white rounded-2xl p-6 text-center shadow-md">
                <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-4xl">{member.emoji}</span>
                </div>
                <h3 className="font-semibold text-gray-900">{member.name}</h3>
                <p className="text-sm text-gray-500">{member.role}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-12 md:py-16">
        <div className="max-w-6xl mx-auto px-4">
          <div className="bg-gray-900 rounded-3xl p-8 md:p-12 text-center text-white" data-animate="scale-up">
            <h2 className="text-2xl md:text-3xl font-bold mb-4">Ready to Try Our Food?</h2>
            <p className="text-gray-400 mb-6 max-w-md mx-auto">
              Browse our menu and experience the taste that everyone's talking about!
            </p>
            <Link 
              to="/menu" 
              className="inline-flex items-center gap-2 bg-orange-500 text-white px-8 py-3 rounded-full font-semibold hover:bg-orange-600 transition-colors"
            >
              View Menu <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
