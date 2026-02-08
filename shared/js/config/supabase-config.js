// This is the "Brain" setup that connects your app to the Cloud
// You will get these two pieces of information from Supabase.com

const SUPABASE_URL = 'https://vrlggkcrbedppeziwlcc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZybGdna2NyYmVkcHBleml3bGNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3ODc1MDEsImV4cCI6MjA4NTM2MzUwMX0.ups2Hbus9sIYJBSFrZe1khrkmXEnZC8bODQ6f5esS68';

// We initialize the connection
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// EXAMPLE: This is how the app will "Talk" to the cloud
async function signUpUser(email, password, fullName, role) {
    const { data, error } = await supabaseClient.auth.signUp({
        email: email,
        password: password,
        options: {
            data: {
                full_name: fullName,
                role: role
            }
        }
    });

    if (error) {
        console.error('Error signing up:', error.message);
        alert('Could not create account: ' + error.message);
    } else {
        console.log('User created in the cloud!', data);
        alert('Welcome to Pedicab Support!');
    }
}
